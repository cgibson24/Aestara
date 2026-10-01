// The permission catalog and system roles, loaded once at start-up. They are
// seeded by the catalog migration and only change through migrations (custom
// roles are UD-07, not enabled), so a request never has to join them.
import { isPlatformUngrantable } from "@aestara/database";
import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { Database } from "../db/database.ts";

export interface CatalogRole {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: ReadonlySet<string>;
  /** Carries a permission a platform actor may never grant (spec §4.5 rule 2). */
  readonly clinical: boolean;
}

/** Roles whose holders always need MFA (spec §4.2). */
export const ADMIN_ROLE_KEYS: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "ORGANIZATION_ADMIN",
  "PRACTICE_ADMIN",
]);

@Injectable()
export class Catalog implements OnApplicationBootstrap {
  private roles = new Map<string, CatalogRole>();
  private byKey = new Map<string, CatalogRole>();
  private permissionList: { key: string; description: string }[] = [];

  constructor(private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    const [roles, permissions] = await Promise.all([
      this.db.app.role.findMany({
        where: { organizationId: null },
        include: { permissions: { include: { permission: true } } },
        orderBy: { key: "asc" },
      }),
      this.db.app.permission.findMany({ orderBy: { key: "asc" } }),
    ]);
    this.roles = new Map(
      roles.map((r) => {
        const keys = new Set(r.permissions.map((p) => p.permission.key));
        return [
          r.id,
          {
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
            permissions: keys,
            clinical: [...keys].some(isPlatformUngrantable),
          },
        ];
      }),
    );
    this.byKey = new Map([...this.roles.values()].map((r) => [r.key, r]));
    this.permissionList = permissions.map((p) => ({ key: p.key, description: p.description }));
    if (this.roles.size === 0)
      throw new Error("The role catalog is empty: run the database migrations first");
  }

  role(id: string): CatalogRole | undefined {
    return this.roles.get(id);
  }

  roleByKey(key: string): CatalogRole | undefined {
    return this.byKey.get(key);
  }

  allRoles(): CatalogRole[] {
    return [...this.roles.values()];
  }

  permissions(): readonly { key: string; description: string }[] {
    return this.permissionList;
  }
}
