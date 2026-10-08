// Treatment catalog (Bible §11.1, §17.1; spec §6.3 "Treatment plans &
// estimates"; ADR-0028 K4-03, ADR-0029). Organization-wide categories (a tree)
// and treatments, which plan items choose from. Nothing is seeded and nothing
// is deleted: entries are retired and can be reactivated. Changes need an
// organization-wide role; the api enforces every rule, and this page only
// offers the actions an entry's status allows.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, type Schemas, unwrap } from "../api/client.ts";
import { queryClient, treatmentCategoriesQuery, treatmentsQuery } from "../api/queries.ts";
import { useAuth } from "../auth/session.tsx";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  messageOf,
  Select,
} from "../ui/kit.tsx";

type Category = Schemas["TreatmentCategory"];
type Treatment = Schemas["Treatment"];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const price = (t: Treatment) => (t.defaultUnitPrice ? usd.format(Number(t.defaultUnitPrice.amount)) : "—");

/** Categories in tree order, each with its depth. */
function tree(categories: Category[]): { category: Category; depth: number }[] {
  const byParent = new Map<string | undefined, Category[]>();
  for (const c of categories) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  for (const list of byParent.values())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const out: { category: Category; depth: number }[] = [];
  const known = new Set(categories.map((c) => c.id));
  const walk = (parent: string | undefined, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // A parent outside the loaded list cannot happen within one organization; show such rows at the top level.
  for (const c of categories) if (c.parentId && !known.has(c.parentId)) out.push({ category: c, depth: 0 });
  return out;
}

/** A category and every subcategory under it: the parents it may not move under. */
function subtree(categories: Category[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories)
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
  }
  return ids;
}

const reload = () =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ["treatment-categories"] }),
    queryClient.invalidateQueries({ queryKey: ["treatments"] }),
  ]);

type Editing =
  | { kind: "category"; source?: Category; parentId?: string }
  | { kind: "treatment"; source?: Treatment; categoryId: string };

export function CatalogPage() {
  const { can } = useAuth();
  const manage = can("practice.manage");
  const categories = useQuery(treatmentCategoriesQuery);
  const treatments = useQuery(treatmentsQuery);
  const [showRetired, setShowRetired] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<Editing>();

  const error = categories.error ?? treatments.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void categories.refetch();
          void treatments.refetch();
        }}
      />
    );
  if (categories.data === undefined || treatments.data === undefined)
    return <LoadingState label="Loading the treatment catalog" />;
  const all = categories.data;
  const rows = tree(all).filter((r) => showRetired || r.category.status === "ACTIVE");
  const current = all.find((c) => c.id === selected);

  return (
    <div className="split">
      <section className="list-pane" aria-labelledby="catalog-title">
        <header className="pane-header">
          <h1 id="catalog-title">Treatment catalog</h1>
          {manage && (
            <Button
              onClick={() => {
                setSelected(undefined);
                setEditing({ kind: "category" });
              }}
            >
              New category
            </Button>
          )}
        </header>
        <p className="muted">
          Treatments that plan options are built from, shared by every practice of the organization. Changes
          need an organization-wide role.
        </p>
        <label className="row">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired entries
        </label>
        {rows.length === 0 ? (
          <EmptyState title={all.length === 0 ? "The catalog is empty" : "No active categories"}>
            <p>
              {all.length === 0
                ? "Nothing is preloaded: add your practice's own categories and treatments."
                : "Show retired entries, or create a category."}
            </p>
          </EmptyState>
        ) : (
          <ul className="plain-list" aria-label="Categories">
            {rows.map(({ category, depth }) => (
              <li key={category.id} style={{ paddingInlineStart: `calc(var(--space-lg) * ${depth})` }}>
                <button
                  type="button"
                  className="link"
                  aria-current={category.id === selected ? "true" : undefined}
                  onClick={() => {
                    setEditing(undefined);
                    setSelected(category.id);
                  }}
                >
                  {category.name}
                </button>{" "}
                <span className="muted">
                  {
                    treatments.data.filter((t) => t.categoryId === category.id && t.status === "ACTIVE")
                      .length
                  }{" "}
                  active
                </span>
                {category.status === "INACTIVE" && <Badge>Retired</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="detail-pane" aria-live="polite">
        {editing?.kind === "category" ? (
          <CategoryForm
            key={editing.source?.id ?? `new-${editing.parentId ?? "top"}`}
            source={editing.source}
            parentId={editing.parentId}
            categories={all}
            onCancel={() => setEditing(undefined)}
            onSaved={async (saved) => {
              setEditing(undefined);
              setSelected(saved.id);
              await reload();
            }}
          />
        ) : editing?.kind === "treatment" ? (
          <TreatmentForm
            key={editing.source?.id ?? `new-${editing.categoryId}`}
            source={editing.source}
            categoryId={editing.categoryId}
            categories={all.filter((c) => c.status === "ACTIVE")}
            onCancel={() => setEditing(undefined)}
            onSaved={async (saved) => {
              setEditing(undefined);
              setSelected(saved.categoryId);
              await reload();
            }}
          />
        ) : current ? (
          <CategoryDetail
            category={current}
            parentName={all.find((c) => c.id === current.parentId)?.name}
            treatments={treatments.data.filter(
              (t) => t.categoryId === current.id && (showRetired || t.status === "ACTIVE"),
            )}
            manage={manage}
            onEdit={() => setEditing({ kind: "category", source: current })}
            onAddSubcategory={() => setEditing({ kind: "category", parentId: current.id })}
            onAddTreatment={() => setEditing({ kind: "treatment", categoryId: current.id })}
            onEditTreatment={(t) => setEditing({ kind: "treatment", source: t, categoryId: t.categoryId })}
            onChanged={reload}
          />
        ) : (
          <EmptyState title="Select a category">
            <p>Each category holds treatments and can hold subcategories.</p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

/** Retire or reactivate with a confirmation that says what changes. */
function StatusAction({
  label,
  entry,
  onConfirm,
}: {
  label: string;
  entry: { status: Schemas["OperationalStatus"] };
  onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const retiring = entry.status === "ACTIVE";
  if (!confirming)
    return (
      <Button variant={retiring ? "danger" : "secondary"} onClick={() => setConfirming(true)}>
        {retiring ? `Retire ${label}` : `Reactivate ${label}`}
      </Button>
    );
  return (
    <fieldset className="confirm">
      <legend className="muted">Confirm</legend>
      <p>
        {retiring
          ? `Retire this ${label}? New plans can no longer use it; existing plans and procedures keep it. You can reactivate it later.`
          : `Reactivate this ${label}? New plans can use it again.`}
      </p>
      <div className="row">
        <Button
          variant={retiring ? "danger" : "primary"}
          onClick={() => void onConfirm().finally(() => setConfirming(false))}
        >
          {retiring ? "Retire" : "Reactivate"}
        </Button>
        <Button variant="quiet" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function CategoryDetail({
  category,
  parentName,
  treatments,
  manage,
  onEdit,
  onAddSubcategory,
  onAddTreatment,
  onEditTreatment,
  onChanged,
}: {
  category: Category;
  parentName: string | undefined;
  treatments: Treatment[];
  manage: boolean;
  onEdit: () => void;
  onAddSubcategory: () => void;
  onAddTreatment: () => void;
  onEditTreatment: (t: Treatment) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string>();
  const run = async (change: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await change();
      await onChanged();
    } catch (err) {
      setError(messageOf(err));
    }
  };
  const flipCategory = () =>
    run(async () =>
      unwrap(
        await api.PATCH("/treatment-categories/{id}", {
          params: { path: { id: category.id }, header: { "If-Match": ifMatch(category.version) } },
          body: { status: category.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
        }),
      ),
    );
  const flipTreatment = (t: Treatment) =>
    run(async () =>
      unwrap(
        await api.PATCH("/treatments/{id}", {
          params: { path: { id: t.id }, header: { "If-Match": ifMatch(t.version) } },
          body: { status: t.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
        }),
      ),
    );

  return (
    <article className="stack" aria-labelledby="category-title">
      <header className="stack">
        <h2 id="category-title">{category.name}</h2>
        <div className="row wrap">
          <Badge tone={category.status === "ACTIVE" ? "success" : "neutral"}>
            {category.status === "ACTIVE" ? "Active" : "Retired"}
          </Badge>
          <span className="muted">{parentName ? `In ${parentName}` : "Top level"}</span>
        </div>
      </header>
      {error && <Banner tone="danger">{error}</Banner>}
      {manage && (
        <div className="row wrap">
          <Button onClick={onEdit}>Edit category</Button>
          {category.status === "ACTIVE" && (
            <>
              <Button variant="secondary" onClick={onAddTreatment}>
                Add a treatment
              </Button>
              <Button variant="secondary" onClick={onAddSubcategory}>
                Add a subcategory
              </Button>
            </>
          )}
          <StatusAction label="category" entry={category} onConfirm={flipCategory} />
        </div>
      )}
      {treatments.length === 0 ? (
        <EmptyState title="No treatments here">
          <p>
            {category.status === "ACTIVE"
              ? "Add the treatments this category offers."
              : "This category is retired."}
          </p>
        </EmptyState>
      ) : (
        <table className="table">
          <caption className="muted">Treatments</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Code</th>
              <th scope="col">Default price</th>
              <th scope="col">Status</th>
              {manage && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {treatments.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.unitLabel && <div className="muted">per {t.unitLabel}</div>}
                </td>
                <td className="mono">{t.code ?? "—"}</td>
                <td>{price(t)}</td>
                <td>
                  <Badge tone={t.status === "ACTIVE" ? "success" : "neutral"}>
                    {t.status === "ACTIVE" ? "Active" : "Retired"}
                  </Badge>
                </td>
                {manage && (
                  <td>
                    <div className="row wrap">
                      <Button
                        variant="quiet"
                        aria-label={`Edit ${t.name}`}
                        onClick={() => onEditTreatment(t)}
                      >
                        Edit
                      </Button>
                      <StatusAction label="treatment" entry={t} onConfirm={() => flipTreatment(t)} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">
        Default prices are in US dollars, before any tax, and prefill a plan item, which can change them.
      </p>
    </article>
  );
}

function CategoryForm({
  source,
  parentId,
  categories,
  onCancel,
  onSaved,
}: {
  source: Category | undefined;
  parentId: string | undefined;
  categories: Category[];
  onCancel: () => void;
  onSaved: (c: Category) => Promise<void>;
}) {
  const [name, setName] = useState(source?.name ?? "");
  const [parent, setParent] = useState(source?.parentId ?? parentId ?? "");
  const [sortOrder, setSortOrder] = useState(String(source?.sortOrder ?? 0));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const excluded = source ? subtree(categories, source.id) : new Set<string>();
  const parents = categories.filter((c) => c.status === "ACTIVE" && !excluded.has(c.id));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const order = Number.parseInt(sortOrder, 10) || 0;
      const saved = source
        ? unwrap(
            await api.PATCH("/treatment-categories/{id}", {
              params: { path: { id: source.id }, header: { "If-Match": ifMatch(source.version) } },
              body: { name, parentId: parent || null, sortOrder: order },
            }),
          ).data
        : unwrap(
            await api.POST("/treatment-categories", {
              body: { name, sortOrder: order, ...(parent ? { parentId: parent } : {}) },
            }),
          ).data;
      await onSaved(saved);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      aria-labelledby="category-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="category-form-title">{source ? "Edit category" : "New category"}</h2>
      {error && <Banner tone="danger">{error}</Banner>}
      <Field label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <Select label="Inside" value={parent} onChange={(e) => setParent(e.target.value)}>
        <option value="">Top level</option>
        {tree(parents).map(({ category, depth }) => (
          <option key={category.id} value={category.id}>
            {`${"— ".repeat(depth)}${category.name}`}
          </option>
        ))}
      </Select>
      <Field
        label="Sort order"
        hint="Lower numbers are listed first."
        type="number"
        min={0}
        max={10000}
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
      />
      <div className="row">
        <Button type="submit" disabled={busy}>
          Save category
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TreatmentForm({
  source,
  categoryId,
  categories,
  onCancel,
  onSaved,
}: {
  source: Treatment | undefined;
  categoryId: string;
  categories: Category[];
  onCancel: () => void;
  onSaved: (t: Treatment) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    categoryId: source?.categoryId ?? categoryId,
    name: source?.name ?? "",
    code: source?.code ?? "",
    description: source?.description ?? "",
    unitLabel: source?.unitLabel ?? "",
    price: source?.defaultUnitPrice?.amount ?? "",
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...change }));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const amount = draft.price.trim() === "" ? null : Number(draft.price).toFixed(2);
    if (amount !== null && (Number.isNaN(Number(draft.price)) || Number(draft.price) < 0)) {
      setError("Enter the default price as an amount of zero or more, such as 450.00, or leave it empty.");
      setBusy(false);
      return;
    }
    const text = (v: string) => (v.trim() === "" ? null : v.trim());
    try {
      const saved = source
        ? unwrap(
            await api.PATCH("/treatments/{id}", {
              params: { path: { id: source.id }, header: { "If-Match": ifMatch(source.version) } },
              body: {
                ...(draft.categoryId !== source.categoryId ? { categoryId: draft.categoryId } : {}),
                name: draft.name,
                code: text(draft.code),
                description: text(draft.description),
                unitLabel: text(draft.unitLabel),
                defaultUnitPrice: amount === null ? null : { amount, currency: "USD" },
              },
            }),
          ).data
        : unwrap(
            await api.POST("/treatments", {
              body: {
                categoryId: draft.categoryId,
                name: draft.name,
                ...(text(draft.code) ? { code: draft.code.trim() } : {}),
                ...(text(draft.description) ? { description: draft.description.trim() } : {}),
                ...(text(draft.unitLabel) ? { unitLabel: draft.unitLabel.trim() } : {}),
                ...(amount !== null ? { defaultUnitPrice: { amount, currency: "USD" } } : {}),
              },
            }),
          ).data;
      await onSaved(saved);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      aria-labelledby="treatment-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="treatment-form-title">{source ? "Edit treatment" : "New treatment"}</h2>
      {error && <Banner tone="danger">{error}</Banner>}
      <Select label="Category" value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
        {tree(categories).map(({ category, depth }) => (
          <option key={category.id} value={category.id}>
            {`${"— ".repeat(depth)}${category.name}`}
          </option>
        ))}
      </Select>
      <Field
        label="Name"
        required
        maxLength={120}
        value={draft.name}
        onChange={(e) => set({ name: e.target.value })}
      />
      <Field
        label="Code"
        hint="Optional; unique in the organization. Letters, digits, '.', '_' or '-'."
        maxLength={40}
        pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,39}"
        value={draft.code}
        onChange={(e) => set({ code: e.target.value })}
      />
      <Field
        label="Description"
        hint="Optional."
        maxLength={1000}
        value={draft.description}
        onChange={(e) => set({ description: e.target.value })}
      />
      <Field
        label="Pricing unit"
        hint='Optional, such as "syringe" or "area".'
        maxLength={40}
        value={draft.unitLabel}
        onChange={(e) => set({ unitLabel: e.target.value })}
      />
      <Field
        label="Default unit price (USD)"
        hint="Optional; prefills a plan item, which can change it."
        inputMode="decimal"
        value={draft.price}
        onChange={(e) => set({ price: e.target.value })}
      />
      <div className="row">
        <Button type="submit" disabled={busy}>
          Save treatment
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
