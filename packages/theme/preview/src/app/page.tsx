"use client";

import { useState } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { ChatComposer } from "@astryxdesign/core/Chat";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { Card } from "@astryxdesign/core/Card";
import { neriloTheme } from "../../../dist/nerilo.js";

export default function ThemePreview() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [agent, setAgent] = useState("Programmer");
  const [prompt, setPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState("");

  return (
    <Theme theme={neriloTheme} mode={mode}>
      <div className="nerilo-preview">
        <header className="preview-header">
          <div className="wordmark" aria-label="Nerilo">
            nerilo<span aria-hidden="true">.</span>
          </div>
          <div className="preview-actions">
            <Text type="supporting">Astryx theme study</Text>
            <Button
              label={mode === "light" ? "Dark appearance" : "Light appearance"}
              variant="secondary"
              onClick={() => setMode(mode === "light" ? "dark" : "light")}
            />
          </div>
        </header>
        <main className="preview-main">
          <section className="welcome" aria-labelledby="welcome-heading">
            <Text type="label" color="accent">
              YOUR WORK, WITH ROOM TO BREATHE
            </Text>
            <Heading level={1} type="editorial" id="welcome-heading">
              Room to make.
            </Heading>
            <Text as="p" color="secondary">
              A little direction. A lot of possibility.
            </Text>
          </section>
          <div className="workspace-grid">
            <section
              className="work-column"
              aria-label="Task composition and status"
            >
              <ChatComposer
                value={prompt}
                onChange={setPrompt}
                placeholder="What would you like to work on?"
                density="spacious"
                elevation="none"
                onSubmit={(value) => {
                  setMessage(`Sample task: ${value}. No agent is running.`);
                  setPrompt("");
                }}
                footerActions={
                  <Selector
                    label="Agent"
                    isLabelHidden
                    variant="ghost"
                    options={["Programmer", "Reviewer"]}
                    value={agent}
                    onChange={setAgent}
                  />
                }
              />
              <div aria-live="polite">
                {message && (
                  <Text as="p" color="accent">
                    {message}
                  </Text>
                )}
              </div>
              <section
                className="task-group"
                aria-labelledby="task-group-title"
              >
                <Heading level={2} id="task-group-title">
                  A few things in motion
                </Heading>
                <div className="task-row">
                  <div>
                    <Text display="block" weight="medium">
                      Tighten workspace permissions
                    </Text>
                    <Text type="supporting">
                      One policy decision before the final check
                    </Text>
                  </div>
                  <Badge
                    variant="warning"
                    label={decision ? "Decision recorded" : "Needs you"}
                  />
                </div>
                <div className="task-row">
                  <div>
                    <Text display="block" weight="medium">
                      A warmer first five minutes
                    </Text>
                    <Text type="supporting">
                      Checking the new onboarding flow
                    </Text>
                  </div>
                  <Badge variant="info" label="Checking" />
                </div>
                <div className="task-row">
                  <div>
                    <Text display="block" weight="medium">
                      Make search feel effortless
                    </Text>
                    <Text type="supporting">
                      Changes and verification are ready
                    </Text>
                  </div>
                  <Badge variant="success" label="Ready to review" />
                </div>
              </section>
              <section
                className="component-states"
                aria-labelledby="states-title"
              >
                <Heading level={3} id="states-title">
                  Clear at every step
                </Heading>
                <div className="state-line">
                  <Badge variant="neutral" label="Queued" />
                  <Badge variant="info" label="Working" />
                  <Badge variant="success" label="Complete" />
                  <Badge variant="error" label="Setup failed" />
                </div>
                <div className="state-line">
                  <Button
                    label="View changes"
                    variant="primary"
                    onClick={() =>
                      setMessage(
                        "The component preview has no repository changes to open.",
                      )
                    }
                  />
                  <Button label="Continue" variant="secondary" isDisabled />
                  <Button label="Checking" isLoading />
                  <Button
                    label="Remove draft"
                    variant="destructive"
                    onClick={() => {
                      setPrompt("");
                      setMessage("Draft cleared in this preview.");
                    }}
                  />
                </div>
              </section>
            </section>
            <aside
              className="evidence-column"
              aria-labelledby="decision-heading"
            >
              <Card padding={6}>
                <div className="decision-stack">
                  <Text type="label" color="accent">
                    A MOMENT FOR YOUR JUDGMENT
                  </Text>
                  <Heading level={2} id="decision-heading">
                    Who can edit a workspace?
                  </Heading>
                  <Text as="p" color="secondary">
                    The suspended-user guard stays in place. Choose how
                    administrators should be treated.
                  </Text>
                  {decision ? (
                    <div aria-live="polite">
                      <Text as="p">{decision}</Text>
                      <Text type="supporting">
                        Selected for this preview. No policy was changed.
                      </Text>
                      <Button
                        label="Choose again"
                        variant="ghost"
                        onClick={() => setDecision("")}
                      />
                    </div>
                  ) : (
                    <div className="decision-buttons">
                      <Button
                        label="Require membership"
                        variant="primary"
                        width="100%"
                        onClick={() =>
                          setDecision(
                            "Every editor must be a workspace member.",
                          )
                        }
                      />
                      <Button
                        label="Allow administrators"
                        variant="secondary"
                        width="100%"
                        onClick={() =>
                          setDecision(
                            "Active organization administrators can edit any workspace.",
                          )
                        }
                      />
                    </div>
                  )}
                  <div className="evidence-note">
                    <Text type="supporting">
                      Evidence stays close to the decision, so you can judge the
                      work with confidence.
                    </Text>
                  </div>
                </div>
              </Card>
              <div className="brand-note">
                <Text type="large" color="inherit">
                  Made with care.
                  <br />
                  Made with Nerilo.
                </Text>
              </div>
            </aside>
          </div>
        </main>
        <footer className="preview-footer">
          <Text type="supporting">
            Real Astryx components · Illustrative task data · No execution
            connected
          </Text>
        </footer>
      </div>
    </Theme>
  );
}
