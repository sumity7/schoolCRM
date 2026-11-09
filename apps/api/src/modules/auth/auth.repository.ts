import { PlatformRepository } from '../../core/tenancy/platform-repository';
import { UserModel, type IUser } from '../users/user.model';
import { SessionModel, type ISession } from './session.model';
import { AuthTokenModel, type IAuthToken } from './auth-token.model';
import { MembershipModel, type IMembership } from '../memberships/membership.model';
import { SchoolModel, type ISchool } from '../schools/school.model';
import { RoleModel, type IRole } from '../roles/role.model';

/**
 * Identity/bootstrap data access. These reads are deliberately cross-tenant (a user belongs to many schools,
 * a session has no tenant yet at login). Each call carries a reason; this file is only importable from
 * modules/auth, modules/users, modules/schools, modules/platform and core/* (ESLint).
 */
export const users = new PlatformRepository<IUser>(UserModel);
export const sessions = new PlatformRepository<ISession>(SessionModel);
export const authTokens = new PlatformRepository<IAuthToken>(AuthTokenModel);
export const memberships = new PlatformRepository<IMembership>(MembershipModel);
export const schools = new PlatformRepository<ISchool>(SchoolModel);
export const roles = new PlatformRepository<IRole>(RoleModel);
