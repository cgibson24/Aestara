// Patient iOS app scenes. Only released/assigned content appears (Bible 13.2).
import React from "react";
import { conversation, disclaimer, money, patientTodos, plans } from "../data/fixtures";
import { Icon } from "../ui/icons";
import { Badge, Button, Card, IconButton, ListRow, Segmented, StateView, useOffline } from "../ui/kit";
import { Portrait } from "../ui/Portrait";
import { PatientShell } from "../ui/shells";

export function PatientHomeScene() {
  return (
    <PatientShell tab="home" title="Good morning, Ana">
      <StateView
        empty={{
          icon: "home",
          title: "Nothing here yet",
          body: "Your care team will share items after your visit.",
        }}
        deniedWhat="this practice's records"
      >
        <section className="hero-card">
          <span className="text-caption1 hero-eyebrow">Next visit</span>
          <div className="text-title3">Two-week review</div>
          <div className="hero-when">
            <Icon name="calendar" size={18} /> Wed, Oct 14 · 10:30 AM
          </div>
          <div className="hero-where">Madison Avenue · Dr. Mia Kim</div>
          <div className="hero-actions">
            <Button variant="secondary" icon="calendar">
              Add to calendar
            </Button>
            <Button variant="tertiary">Reschedule</Button>
          </div>
        </section>
        <h2 className="section-title">To do</h2>
        <div className="list list-inset">
          {patientTodos.map((t) => (
            <ListRow
              key={t.title}
              leading={
                <span className={`todo-icon todo-${t.tone}`}>
                  <Icon name={t.icon} size={20} />
                </span>
              }
              title={t.title}
              subtitle={t.detail}
            />
          ))}
        </div>
        <h2 className="section-title">From your care team</h2>
        <div className="list list-inset">
          <ListRow
            leading={
              <span className="todo-icon todo-neutral">
                <Icon name="message" size={20} />
              </span>
            }
            title="Jordan Alvarez, RN"
            subtitle="Your consultation summary, your visualization and three plan options are now in the app."
          />
        </div>
      </StateView>
    </PatientShell>
  );
}

export function PatientSimulationScene() {
  const [show, setShow] = React.useState<"viz" | "photo">("viz");
  return (
    <PatientShell tab="care" title="Your visualization" back="My care" largeTitle={false}>
      <StateView
        empty={{
          icon: "sparkles",
          title: "No visualizations yet",
          body: "If your provider shares one, it will appear here.",
        }}
        deniedWhat="visualizations"
      >
        <div className="disclaimer" role="note">
          <Icon name="info" size={20} />
          <p>{disclaimer}</p>
        </div>
        <figure className="patient-photo">
          <Portrait view="FRONT" lipFullness={show === "viz" ? 3 : 0} />
          {show === "viz" ? (
            <span className="ai-tag">
              <Icon name="sparkles" size={14} /> AI visualization
            </span>
          ) : null}
        </figure>
        <Segmented
          label="Image"
          value={show}
          onChange={setShow}
          options={[
            { value: "viz", label: "Visualization" },
            { value: "photo", label: "Your photo" },
          ]}
        />
        <Card>
          <div className="meta-rows">
            <div>
              <span className="muted">Treatment area</span>
              <span>Lips</span>
            </div>
            <div>
              <span className="muted">Shared by</span>
              <span>Dr. Mia Kim · today</span>
            </div>
          </div>
        </Card>
        <Button variant="secondary" icon="message" full>
          Ask your care team
        </Button>
      </StateView>
    </PatientShell>
  );
}

export function PatientPlanScene() {
  const plan = plans[1] ?? plans[0];
  const offline = useOffline();
  if (!plan) return null;
  const total = plan.items.reduce((s, i) => s + i.price, 0) - plan.discount;
  return (
    <PatientShell tab="care" title="Treatment options" back="My care" largeTitle={false}>
      <StateView
        empty={{
          icon: "clipboard",
          title: "No plans yet",
          body: "Plans your provider sends will appear here.",
        }}
        deniedWhat="treatment plans"
      >
        <Segmented
          label="Plan"
          value="Plan B"
          onChange={() => undefined}
          options={plans.map((p) => ({ value: p.label, label: p.label }))}
        />
        <section className="plan patient-plan">
          <header className="plan-head">
            <span className="plan-label">{plan.label}</span>
            <Badge tone="accent">Suggested by Dr. Kim</Badge>
          </header>
          <h2 className="text-title2">{plan.title}</h2>
          <p className="text-subheadline muted">{plan.note}</p>
          <ul className="patient-items">
            {plan.items.map((i) => (
              <li key={i.treatment}>
                <span>
                  {i.treatment}
                  <span className="text-footnote muted">
                    {i.area === "—" ? i.qty : `${i.area} · ${i.qty}`}
                  </span>
                </span>
                <span className="num">{i.price ? money(i.price) : "Included"}</span>
              </li>
            ))}
          </ul>
          <div className="plan-total patient-total">
            <span>Estimated total</span>
            <span className="num">{money(total)}</span>
          </div>
          <p className="text-footnote muted">
            Includes a {money(plan.discount)} discount. This is an estimate, not a bill. Choosing a plan is
            not consent to treatment; you'll review a consent form separately.
          </p>
        </section>
        <div className="stacked-actions">
          <Button variant="primary" size="lg" full disabled={offline}>
            Choose Plan B
          </Button>
          <Button variant="secondary" size="lg" icon="message" full>
            I have a question
          </Button>
          <Button variant="tertiary" full>
            Not for me
          </Button>
        </div>
      </StateView>
    </PatientShell>
  );
}

export function PatientMessagesScene() {
  return (
    <PatientShell tab="messages" title="Care team" back="Messages" largeTitle={false}>
      <StateView
        empty={{ icon: "message", title: "No messages", body: "You can message your care team any time." }}
        deniedWhat="messages"
      >
        <div className="bubbles patient-bubbles">
          {conversation.map((m) => (
            <div
              key={m.time + m.author}
              className={`bubble-row ${m.from === "patient" ? "is-out" : "is-in"}`}
            >
              <div className="bubble">
                <p>{m.text}</p>
                {m.attachment ? (
                  <span className="attachment">
                    <Icon name="doc" size={16} /> {m.attachment}
                  </span>
                ) : null}
              </div>
              <span className="bubble-meta">
                {m.from === "patient" ? "You" : m.author} · {m.time}
              </span>
            </div>
          ))}
        </div>
        <p className="text-footnote muted center">
          For emergencies, call 911. Messages are answered during office hours.
        </p>
        <div className="composer">
          <IconButton icon="photo" label="Add a photo" />
          <input placeholder="Message your care team" aria-label="Message" />
          <IconButton icon="send" label="Send" />
        </div>
      </StateView>
    </PatientShell>
  );
}
