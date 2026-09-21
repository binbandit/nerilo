"use client";

import { Theme } from "@astryxdesign/core/theme";
import { neriloTheme } from "@nerilo/theme";
import { Button } from "@/components/ui/ui";
import { NeriloWordmark } from "@/components/ui/brand";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <Theme theme={neriloTheme} mode="system">
      <main className="nerilo-app workspace-recovery">
        <section role="alert">
          <p
            className="workspace-recovery-brand"
            role="img"
            aria-label="Nerilo"
          >
            <NeriloWordmark />
          </p>
          <h1>This view couldn’t load.</h1>
          <p>Try again to reconnect to your saved tasks.</p>
          <div className="workspace-recovery-actions">
            <Button label="Try again" variant="primary" onClick={retry} />
            <Button
              label="Reload Nerilo"
              variant="ghost"
              onClick={() => window.location.reload()}
            />
          </div>
        </section>
      </main>
    </Theme>
  );
}
