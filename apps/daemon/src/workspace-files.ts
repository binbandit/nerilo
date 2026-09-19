import {
  workspacePathSchema,
  workspaceFilesSchema,
  workspaceFileSchema,
} from "@nerilo/protocol";
import { checked, command, imageTag } from "./config";

// Each path component is opened relative to its parent descriptor without following
// symlinks. This also protects previews while an agent is changing the workspace.
export const workspaceReader = String.raw`
import base64, json, os, stat, subprocess, sys

def valid(path):
    return 0 < len(path) <= 2000 and not any(ord(c) < 32 or ord(c) == 127 for c in path) and all(p not in ('', '.', '..', '.git') for p in path.split('/'))

def open_file(root, path):
    if not valid(path):
        raise ValueError('Choose a file inside this task workspace.')
    parent = os.dup(root)
    try:
        parts = path.split('/')
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError('Only regular workspace files can be previewed.')
        return fd
    finally:
        os.close(parent)

def listing(root):
    git = os.open('.git', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
    os.close(git)
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_OPTIONAL_LOCKS='0')
    child = subprocess.Popen(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=/dev/null', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    files = set()
    truncated = False
    scanned = 0
    pending = b''
    try:
        while True:
            chunk = child.stdout.read1(8192)
            if not chunk:
                break
            pending += chunk
            while b'\0' in pending:
                raw, pending = pending.split(b'\0', 1)
                scanned += 1
                try:
                    path = raw.decode('utf-8')
                    fd = open_file(root, path)
                    os.close(fd)
                    files.add(path)
                except (OSError, ValueError, UnicodeError):
                    pass
                if len(files) > 10000 or scanned >= 100000:
                    truncated = True
                    break
            if truncated:
                break
            if len(pending) > 8192:
                raise ValueError('The workspace returned an invalid file path.')
        if truncated:
            child.terminate()
        elif child.wait() != 0:
            raise ValueError('The task workspace is not ready yet. Try again once the repository is prepared.')
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()
        child.stdout.close()
    return {'files': sorted(files)[:10000], 'truncated': truncated}

def preview(root, path):
    fd = open_file(root, path)
    with os.fdopen(fd, 'rb') as file:
        if os.fstat(file.fileno()).st_size > 2000000:
            raise ValueError('This file is too large for the preview (2 MB limit).')
        data = file.read(2000001)
    if len(data) > 2000000:
        raise ValueError('This file is too large for the preview (2 MB limit).')
    mime = 'png' if data.startswith(b'\x89PNG\r\n\x1a\n') else 'jpeg' if data.startswith(b'\xff\xd8\xff') else None
    if mime:
        return {'path': path, 'content': '', 'image': 'data:image/' + mime + ';base64,' + base64.b64encode(data).decode('ascii')}
    if b'\0' in data:
        raise ValueError('This binary file cannot be previewed as text.')
    return {'path': path, 'content': data.decode('utf-8', errors='replace'), 'image': None}

try:
    work = os.open('/work', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    root = os.open('repo', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=work)
    os.close(work)
    os.fchdir(root)
    try:
        result = listing(root) if sys.argv[1] == 'list' else preview(root, sys.argv[2])
    finally:
        os.close(root)
    print(json.dumps(result))
except ValueError as error:
    print(json.dumps({'error': str(error)}))
except OSError:
    print(json.dumps({'error': 'This file or workspace is unavailable. Refresh after the agent finishes changing it.'}))
`;

async function readWorkspace(taskId: string, args: string[]) {
  if (!/^[a-zA-Z0-9-]+$/.test(taskId))
    throw new Error("Invalid task workspace.");
  const volume = `nerilo-work-${taskId}`;
  const available = await command(["docker", "volume", "inspect", volume]);
  if (available.code !== 0)
    throw new Error("The task workspace is not ready yet. Run the task first.");
  const name = `nerilo-file-reader-${crypto.randomUUID()}`;
  try {
    const output = await checked(
      [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "32",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--user",
        "node",
        "--mount",
        `type=volume,source=${volume},target=/work,readonly,volume-nocopy`,
        "--entrypoint",
        "python3",
        imageTag,
        "-c",
        workspaceReader,
        ...args,
      ],
      { timeout: 15000 },
    );
    const result: unknown = JSON.parse(output);
    if (
      typeof result === "object" &&
      result &&
      "error" in result &&
      typeof result.error === "string"
    )
      throw new Error(result.error);
    return result;
  } finally {
    await command(["docker", "rm", "-f", name], { timeout: 5000 }).catch(
      () => {},
    );
  }
}

export async function listWorkspaceFiles(taskId: string) {
  return workspaceFilesSchema.parse(await readWorkspace(taskId, ["list"]));
}
export async function readWorkspaceFile(taskId: string, path: string) {
  if (!workspacePathSchema.safeParse(path).success)
    throw new Error("Choose a file inside this task workspace.");
  return workspaceFileSchema.parse(await readWorkspace(taskId, ["file", path]));
}
