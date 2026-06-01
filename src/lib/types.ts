/** Domain types — hand-mirrored from sentry-backend Pydantic schemas.
 * Source of truth: sentry-backend `schemas/{auth,org,admin}.py`. Keep in sync;
 * an OpenAPI codegen step (like sentry-frontend's) can replace this later. */

export type OrgRole = "owner" | "admin" | "staff";

export interface UserPublic {
  id: string;
  email: string;
  is_super_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface OrganizationPublic {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface OrgMemberPublic {
  user: UserPublic;
  role: OrgRole;
}

export interface AdminStats {
  orgs: number;
  users: number;
  stores: number;
  cameras: number;
  alerts: number;
}

export interface UserInviteInput {
  email: string;
  password: string;
  organization_id: string;
  role: OrgRole;
  is_super_admin?: boolean;
}

export interface UserAdminUpdate {
  is_active?: boolean;
  is_super_admin?: boolean;
}

export interface LoginResponse {
  user: UserPublic;
  tokens: {
    access_token: string;
    refresh_token: string;
    token_type: string;
  };
}
