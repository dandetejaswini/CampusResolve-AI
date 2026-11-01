import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { getSupabaseEnvConfig, getFirebaseEnvConfig } from '../lib/envConfig';
import {
  getSupabaseAuthClient,
  createSupabaseFirebaseDataClient,
} from '../lib/supabaseClient';
import {
  getFirebaseAuthClient,
  ensureFirebaseAuthenticatedClaim,
  updateFirebaseProfileServerSide,
  EXPECTED_FIREBASE_PROJECT_ID,
} from '../lib/firebaseClient';
import {
  AppProfile,
  AuthProviderType,
  ProfileUpdateInput,
  IdentityResolutionError,
  createSupabaseProfileRepository,
  resolveOrCreateAppProfile,
  updateOwnAppProfile,
  triggerWelcomeEmailIfEligible,
} from '../services/identityService';
import { ActorRole } from '../types/domain';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthActionResult {
  ok: boolean;
  requiresEmailVerification?: boolean;
  code?: string;
  message: string;
}

export interface SignUpWithEmailParams {
  fullName: string;
  email: string;
  password: string;
  department: string;
  requestedRole: string;
}

export interface AuthEnvStatus {
  supabaseConfigured: boolean;
  firebaseConfigured: boolean;
  missingSupabaseVars: string[];
  missingFirebaseVars: string[];
}

export interface DemoAccountConfig {
  role: ActorRole;
  label: string;
  roleTitle: string;
  badge: string;
  email: string;
  displayName: string;
  department: string;
  description: string;
}

export const INSTITUTIONAL_DEMO_ACCOUNTS: DemoAccountConfig[] = [
  {
    role: ActorRole.Learner,
    label: 'Student / Learner',
    roleTitle: 'Enrolled Student',
    badge: 'Undergraduate Cohort',
    email: 'maya.patel@campusresolve.edu',
    displayName: 'Maya Patel (Student Demo)',
    department: 'Computer Science & Engineering',
    description: 'Submit requests, check policy-grounded RAG assistance, and view business-hour SLA timers.',
  },
  {
    role: ActorRole.Instructor,
    label: 'Instructor / Faculty',
    roleTitle: 'Faculty Member',
    badge: 'Mathematics Faculty',
    email: 'arthur.pendelton@campusresolve.edu',
    displayName: 'Dr. Arthur Pendelton (Faculty Demo)',
    department: 'Department of Mathematics',
    description: 'Submit instructional course petitions, student case attestations, and policy clarifications.',
  },
  {
    role: ActorRole.SupportStaff,
    label: 'Operations Staff',
    roleTitle: 'Triage Specialist',
    badge: 'Registrar Operations Desk',
    email: 'elena.rostova@campusresolve.edu',
    displayName: 'Elena Rostova (Staff Demo)',
    department: 'Student Affairs & Registrar Operations',
    description: 'Triage support queues, evaluate ticket routing destinations, and track SLA escalations.',
  },
  {
    role: ActorRole.AcademicAdministrator,
    label: 'Academic Administrator / Dean',
    roleTitle: 'Academic Dean & Ombuds',
    badge: 'Provost Case Review Office',
    email: 'eleanor.sterling@campusresolve.edu',
    displayName: 'Dean Eleanor Sterling (Admin Demo)',
    department: 'Office of the Provost & Academic Affairs',
    description: 'Adjudicate administrative policy appeals, approve escalations, and manage policy versions.',
  },
  {
    role: ActorRole.PlatformAdministrator,
    label: 'Platform Administrator',
    roleTitle: 'System & Routing Admin',
    badge: 'Institutional Governance',
    email: 'marcus.chen@campusresolve.edu',
    displayName: 'Marcus Chen (Platform Demo)',
    department: 'Campus IT & Institutional Governance',
    description: 'Configure SLA schedules, inspect routing rules, and execute reproducibility benchmarks.',
  },
];

export interface AuthContextValue {
  status: AuthStatus;
  profile: AppProfile | null;
  activeProvider: AuthProviderType | null;
  envStatus: AuthEnvStatus;
  welcomeEmailNotice: string | null;
  authWarning: string | null;
  dismissNotices: () => void;
  signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  signUpWithEmail: (params: SignUpWithEmailParams) => Promise<AuthActionResult>;
  signInWithGoogle: () => Promise<AuthActionResult>;
  signInDemoAccount: (role: ActorRole) => Promise<AuthActionResult>;
  requestPasswordReset: (email: string) => Promise<AuthActionResult>;
  updatePassword: (newPassword: string) => Promise<AuthActionResult>;
  updateProfile: (updates: ProfileUpdateInput) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [activeProvider, setActiveProvider] = useState<AuthProviderType | null>(
    null
  );
  const [welcomeEmailNotice, setWelcomeEmailNotice] = useState<string | null>(
    null
  );
  const [authWarning, setAuthWarning] = useState<string | null>(null);

  const supabaseEnv = getSupabaseEnvConfig();
  const firebaseEnv = getFirebaseEnvConfig();

  const envStatus: AuthEnvStatus = {
    supabaseConfigured: supabaseEnv.isConfigured,
    firebaseConfigured: firebaseEnv.isConfigured,
    missingSupabaseVars: supabaseEnv.missingVars,
    missingFirebaseVars: firebaseEnv.missingVars,
  };

  const inFlightSyncRef = React.useRef<
    Map<string, Promise<AuthActionResult>>
  >(new Map());

  const dismissNotices = useCallback(() => {
    setWelcomeEmailNotice(null);
    setAuthWarning(null);
  }, []);

  /**
   * Synchronizes a Supabase Email/Password user with `public.app_profiles`
   * and triggers the one-time welcome email if eligible.
   */
  const syncSupabaseUserProfile = useCallback(
    async (user: SupabaseUser): Promise<AuthActionResult> => {
      const syncKey = `supabase_email:${user.id}`;
      const existingPromise = inFlightSyncRef.current.get(syncKey);
      if (existingPromise) {
        return await existingPromise;
      }

      const promise = (async (): Promise<AuthActionResult> => {
        const supabase = getSupabaseAuthClient();
        if (!supabase) {
          return {
            ok: false,
            code: 'SUPABASE_NOT_CONFIGURED',
            message: 'Supabase client is not configured.',
          };
        }

        const emailVerified = Boolean(user.email_confirmed_at);
        if (!emailVerified || !user.email) {
          setProfile(null);
          setActiveProvider(null);
          setStatus('unauthenticated');
          return {
            ok: false,
            requiresEmailVerification: true,
            code: 'EMAIL_NOT_VERIFIED',
            message:
              'Your email address has not been verified yet. Please check your inbox and confirm your institutional email before signing in.',
          };
        }

        try {
          const repo = createSupabaseProfileRepository(supabase);
          const meta = user.user_metadata || {};

          const { profile: resolvedProfile } = await resolveOrCreateAppProfile(
            {
              authProvider: 'supabase_email',
              providerSubject: user.id,
              email: user.email,
              emailVerified: true,
              displayName: meta.full_name || meta.display_name,
              department: meta.department,
              requestedRoleNote: meta.requested_role_note,
            },
            repo
          );

          const { data: sessionData } = await supabase.auth.getSession();
          const bearerToken = sessionData.session?.access_token || '';

          const welcomeRes = await triggerWelcomeEmailIfEligible(
            resolvedProfile,
            repo,
            { bearerToken }
          );

          setProfile(welcomeRes.updatedProfile);
          setActiveProvider('supabase_email');
          setStatus('authenticated');
          if (welcomeRes.triggered) {
            setWelcomeEmailNotice(welcomeRes.message);
          }

          return {
            ok: true,
            message: 'Signed in with institutional email.',
          };
        } catch (err) {
          await supabase.auth.signOut().catch(() => {});
          setProfile(null);
          setActiveProvider(null);
          setStatus('unauthenticated');

          if (err instanceof IdentityResolutionError) {
            return {
              ok: false,
              code: err.code,
              message: err.message,
            };
          }

          return {
            ok: false,
            code: 'PROFILE_SYNC_FAILED',
            message:
              err instanceof Error
                ? err.message
                : 'Unable to synchronize your institutional profile. Please try signing in again.',
          };
        }
      })();

      inFlightSyncRef.current.set(syncKey, promise);
      try {
        return await promise;
      } finally {
        inFlightSyncRef.current.delete(syncKey);
      }
    },
    []
  );

  /**
   * Synchronizes a Firebase Google user (`campusresolveai`) with `public.app_profiles`
   * using the official Supabase Third-Party Auth client (`accessToken` callback).
   */
  const syncFirebaseUserProfile = useCallback(
    async (fbUser: FirebaseUser): Promise<AuthActionResult> => {
      const syncKey = `firebase_google:${fbUser.uid}`;
      const existingPromise = inFlightSyncRef.current.get(syncKey);
      if (existingPromise) {
        return await existingPromise;
      }

      const promise = (async (): Promise<AuthActionResult> => {
        const fbBundle = getFirebaseAuthClient();
        if (!supabaseEnv.isConfigured) {
          if (fbBundle) {
            await firebaseSignOut(fbBundle.auth).catch(() => {});
          }
          setProfile(null);
          setActiveProvider(null);
          setStatus('unauthenticated');
          return {
            ok: false,
            code: 'SUPABASE_NOT_CONFIGURED',
            message:
              'Institutional directory service is not configured in this environment. Please contact your platform administrator.',
          };
        }

        if (!fbUser.email || !fbUser.emailVerified) {
          if (fbBundle) {
            await firebaseSignOut(fbBundle.auth).catch(() => {});
          }
          setProfile(null);
          setActiveProvider(null);
          setStatus('unauthenticated');
          return {
            ok: false,
            code: 'UNVERIFIED_GOOGLE_EMAIL',
            message:
              'Your Google account must have a verified email address to access CampusResolve AI.',
          };
        }

        try {
          // 1. Verify Firebase ID token on the server and provision/resolve the institutional profile
          const claimStatus = await ensureFirebaseAuthenticatedClaim(fbUser, {
            displayName: fbUser.displayName || undefined,
            department: 'Unassigned Academic Unit',
            requestedRoleNote: null,
          });

          // Create the Supabase Third-Party Auth client for subsequent operations
          const firebaseSupabaseClient = createSupabaseFirebaseDataClient(
            async () => {
              return await fbUser.getIdToken(false);
            }
          );

          if (!firebaseSupabaseClient) {
            throw new IdentityResolutionError(
              'DATABASE_ERROR',
              'Could not initialize institutional directory client for Google Sign-In.'
            );
          }

          const repo = createSupabaseProfileRepository(firebaseSupabaseClient);

          let resolvedProfile: AppProfile;

          if (claimStatus.ok && claimStatus.profile) {
            // Authoritative profile returned directly from server-verified /api/auth/firebase-claim
            resolvedProfile = claimStatus.profile;
          } else if (!claimStatus.ok && claimStatus.errorCode) {
            const mappedCode =
              claimStatus.errorCode === 'CROSS_PROVIDER_EMAIL_CONFLICT'
                ? 'CROSS_PROVIDER_EMAIL_CONFLICT'
                : claimStatus.errorCode === 'ACCOUNT_SUSPENDED'
                ? 'ACCOUNT_SUSPENDED'
                : claimStatus.errorCode === 'UNVERIFIED_GOOGLE_EMAIL'
                ? 'EMAIL_NOT_VERIFIED'
                : 'DATABASE_ERROR';
            throw new IdentityResolutionError(
              mappedCode,
              claimStatus.warningMessage ||
                'We could not complete your Google Sign-In profile setup at this time. Please try again.'
            );
          } else if (claimStatus.hasAuthenticatedRoleClaim) {
            const existing = await repo.findByProviderIdentity('firebase_google', fbUser.uid);
            if (existing) {
              resolvedProfile = existing;
            } else {
              throw new IdentityResolutionError(
                'DATABASE_ERROR',
                claimStatus.warningMessage ||
                  'Your institutional profile could not be provisioned automatically. Please ensure SUPABASE_SERVICE_ROLE_KEY is configured in your server environment.'
              );
            }
          } else {
            throw new IdentityResolutionError(
              'DATABASE_ERROR',
              claimStatus.warningMessage ||
                'We could not complete your Google Sign-In profile setup at this time. Please try signing in again.'
            );
          }

          const fbIdToken = await fbUser.getIdToken(false);

          const welcomeRes = await triggerWelcomeEmailIfEligible(
            resolvedProfile,
            repo,
            { bearerToken: fbIdToken }
          );

          setProfile(welcomeRes.updatedProfile);
          setActiveProvider('firebase_google');
          setStatus('authenticated');
          if (welcomeRes.triggered) {
            setWelcomeEmailNotice(welcomeRes.message);
          }

          return {
            ok: true,
            message: 'Signed in with Google.',
          };
        } catch (err) {
          if (fbBundle) {
            await firebaseSignOut(fbBundle.auth).catch(() => {});
          }
          setProfile(null);
          setActiveProvider(null);
          setStatus('unauthenticated');

          if (err instanceof IdentityResolutionError) {
            return {
              ok: false,
              code: err.code,
              message: err.message,
            };
          }

          return {
            ok: false,
            code: 'FIREBASE_PROFILE_SYNC_FAILED',
            message:
              err instanceof Error
                ? err.message
                : 'Unable to synchronize your Google account with your institutional profile.',
          };
        }
      })();

      inFlightSyncRef.current.set(syncKey, promise);
      try {
        return await promise;
      } finally {
        inFlightSyncRef.current.delete(syncKey);
      }
    },
    [supabaseEnv.isConfigured, supabaseEnv.missingVars]
  );

  // Restore existing Supabase or Firebase session on initial load & subscribe to auth events
  useEffect(() => {
    let isMounted = true;

    // Check for saved demo account profile
    const savedDemo = localStorage.getItem('campusresolve_demo_profile');
    if (savedDemo) {
      try {
        const parsed = JSON.parse(savedDemo);
        if (parsed && parsed.id && parsed.actor_role) {
          setProfile(parsed);
          setActiveProvider('institutional_email');
          setStatus('authenticated');
          return;
        }
      } catch {}
    }

    const supabase = getSupabaseAuthClient();
    const fbBundle = getFirebaseAuthClient();

    if (!supabase && !fbBundle) {
      setStatus('unauthenticated');
      return;
    }

    let supabaseResolved = !supabase;
    let firebaseResolved = !fbBundle;

    const finalizeUnauthenticatedIfBothDone = () => {
      if (!isMounted) return;
      if (supabaseResolved && firebaseResolved) {
        setStatus((prev) => (prev === 'loading' ? 'unauthenticated' : prev));
      }
    };

    if (supabase) {
      supabase.auth
        .getSession()
        .then(async ({ data }) => {
          if (!isMounted) return;
          if (data.session?.user) {
            await syncSupabaseUserProfile(data.session.user);
          }
          supabaseResolved = true;
          finalizeUnauthenticatedIfBothDone();
        })
        .catch(() => {
          supabaseResolved = true;
          finalizeUnauthenticatedIfBothDone();
        });
    }

    const { data: supabaseListener } = supabase
      ? supabase.auth.onAuthStateChange(async (event, session) => {
          if (!isMounted) return;
          if (event === 'SIGNED_OUT') {
            setActiveProvider((current) => {
              if (current === 'supabase_email') {
                setProfile(null);
                setStatus('unauthenticated');
                return null;
              }
              return current;
            });
          } else if (
            (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
            session?.user
          ) {
            await syncSupabaseUserProfile(session.user);
          }
        })
      : { data: { subscription: null } };

    const unsubscribeFirebase = fbBundle
      ? onAuthStateChanged(fbBundle.auth, async (fbUser) => {
          if (!isMounted) return;
          if (fbUser) {
            await syncFirebaseUserProfile(fbUser);
          } else {
            setActiveProvider((current) => {
              if (current === 'firebase_google') {
                setProfile(null);
                setStatus('unauthenticated');
                return null;
              }
              return current;
            });
          }
          firebaseResolved = true;
          finalizeUnauthenticatedIfBothDone();
        })
      : undefined;

    return () => {
      isMounted = false;
      supabaseListener?.subscription?.unsubscribe();
      if (unsubscribeFirebase) {
        unsubscribeFirebase();
      }
    };
  }, [syncSupabaseUserProfile, syncFirebaseUserProfile]);

  const signInWithEmail = async (
    email: string,
    password: string
  ): Promise<AuthActionResult> => {
    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        message:
          'Institutional authentication service is not configured in this environment. Please contact your platform administrator.',
      };
    }

    // Ensure any previous Firebase session is cleared before signing in with Email/Password
    const fbBundle = getFirebaseAuthClient();
    if (fbBundle?.auth.currentUser) {
      await firebaseSignOut(fbBundle.auth).catch(() => {});
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const lowerMsg = error.message.toLowerCase();
        if (lowerMsg.includes('email not confirmed')) {
          return {
            ok: false,
            requiresEmailVerification: true,
            code: 'EMAIL_NOT_VERIFIED',
            message:
              'Your institutional email address has not been verified yet. Please check your inbox and click the verification link before signing in.',
          };
        }
        if (lowerMsg.includes('invalid login credentials')) {
          return {
            ok: false,
            code: 'INVALID_CREDENTIALS',
            message:
              'Invalid institutional email or password. Please verify your credentials and try again.',
          };
        }
        return {
          ok: false,
          code: 'SUPABASE_AUTH_ERROR',
          message: error.message,
        };
      }

      if (!data.user) {
        return {
          ok: false,
          code: 'NO_USER_RETURNED',
          message: 'Authentication did not return a valid user record.',
        };
      }

      return await syncSupabaseUserProfile(data.user);
    } catch (error) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message:
          error instanceof Error
            ? `Network or service error during sign-in: ${error.message}`
            : 'Unable to reach Supabase authentication service.',
      };
    }
  };

  const signUpWithEmail = async (
    params: SignUpWithEmailParams
  ): Promise<AuthActionResult> => {
    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        message:
          'Institutional registration service is not configured in this environment. Please contact your platform administrator.',
      };
    }

    try {
      const redirectUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/sign-in`
          : undefined;

      const { data, error } = await supabase.auth.signUp({
        email: params.email.trim(),
        password: params.password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: params.fullName.trim(),
            display_name: params.fullName.trim(),
            department: params.department.trim(),
            requested_role_note: params.requestedRole,
          },
        },
      });

      if (error) {
        const lowerMsg = error.message.toLowerCase();
        if (lowerMsg.includes('already registered') || lowerMsg.includes('already exists')) {
          return {
            ok: false,
            code: 'DUPLICATE_ACCOUNT',
            message:
              'An account with this institutional email address is already registered. Please sign in or request a password reset.',
          };
        }
        return {
          ok: false,
          code: 'SUPABASE_SIGNUP_ERROR',
          message: error.message,
        };
      }

      if (!data.user) {
        return {
          ok: false,
          code: 'SIGNUP_FAILED',
          message: 'Registration request did not return a user record.',
        };
      }

      // When Supabase obfuscates existing emails, `identities` is returned as an empty array
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return {
          ok: false,
          code: 'DUPLICATE_ACCOUNT',
          message:
            'An account with this institutional email address already exists. Please sign in or use password recovery.',
        };
      }

      // If email confirmation is enabled in Supabase (recommended), `session` is null until verified
      if (!data.session || !data.user.email_confirmed_at) {
        return {
          ok: true,
          requiresEmailVerification: true,
          code: 'VERIFICATION_REQUIRED',
          message: `Account registered for ${params.email.trim()}. A verification link has been sent to your inbox. Please verify your email address to activate your Learner workspace profile.`,
        };
      }

      return await syncSupabaseUserProfile(data.user);
    } catch (error) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message:
          error instanceof Error
            ? `Network error during registration: ${error.message}`
            : 'Unable to reach Supabase authentication service.',
      };
    }
  };

  const signInWithGoogle = async (): Promise<AuthActionResult> => {
    const fbBundle = getFirebaseAuthClient();
    if (!fbBundle) {
      return {
        ok: false,
        code: 'FIREBASE_NOT_CONFIGURED',
        message:
          'Google Single Sign-On is not configured in this environment. Please sign in with your institutional email and password.',
      };
    }

    if (!supabaseEnv.isConfigured) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        message:
          'Institutional directory service is not configured in this environment. Please contact your platform administrator.',
      };
    }

    // Clear any active Supabase Email session before starting Firebase Google sign-in
    const supabase = getSupabaseAuthClient();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }

    try {
      const credential = await signInWithPopup(
        fbBundle.auth,
        fbBundle.googleProvider
      );
      return await syncFirebaseUserProfile(credential.user);
    } catch (error: any) {
      const fbCode: string = error?.code || '';
      if (
        fbCode === 'auth/popup-closed-by-user' ||
        fbCode === 'auth/cancelled-popup-request'
      ) {
        return {
          ok: false,
          code: 'GOOGLE_SIGNIN_CANCELLED',
          message:
            'Google sign-in was cancelled before completion. You may try again or sign in with your institutional email.',
        };
      }
      if (fbCode === 'auth/popup-blocked') {
        return {
          ok: false,
          code: 'GOOGLE_POPUP_BLOCKED',
          message:
            'Your browser blocked the Google authentication popup window. Please allow popups for this domain and try again.',
        };
      }
      if (fbCode === 'auth/network-request-failed') {
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          message:
            'Network connection failed while communicating with Firebase Google Authentication.',
        };
      }

      return {
        ok: false,
        code: fbCode || 'GOOGLE_AUTH_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Google authentication failed.',
      };
    }
  };

  const requestPasswordReset = async (
    email: string
  ): Promise<AuthActionResult> => {
    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        message:
          'Password recovery service is not configured in this environment. Please contact your platform administrator.',
      };
    }

    try {
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}/reset-password`
          : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo,
        }
      );

      if (error) {
        return {
          ok: false,
          code: 'PASSWORD_RESET_ERROR',
          message: error.message,
        };
      }

      return {
        ok: true,
        message: `If an institutional account is registered for ${email.trim()}, a password recovery link has been sent to that address.`,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to request password reset.',
      };
    }
  };

  const updatePassword = async (
    newPassword: string
  ): Promise<AuthActionResult> => {
    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        message:
          'Password update service is not configured in this environment. Please contact your platform administrator.',
      };
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        return {
          ok: false,
          code: 'PASSWORD_UPDATE_ERROR',
          message: error.message,
        };
      }

      return {
        ok: true,
        message: 'Your institutional password has been updated. You may now continue to your workspace.',
      };
    } catch (error) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to update password.',
      };
    }
  };

  const updateProfile = async (
    updates: ProfileUpdateInput
  ): Promise<AuthActionResult> => {
    if (!profile || !activeProvider) {
      return {
        ok: false,
        code: 'UNAUTHENTICATED',
        message: 'You must be signed in to update your profile.',
      };
    }

    try {
      let dataClient = getSupabaseAuthClient();
      if (activeProvider === 'firebase_google') {
        const fbBundle = getFirebaseAuthClient();
        const currentUser = fbBundle?.auth.currentUser;
        if (!currentUser) {
          return {
            ok: false,
            code: 'SESSION_EXPIRED',
            message: 'Your Google authentication session has expired. Please sign in again.',
          };
        }

        const serverUpdate = await updateFirebaseProfileServerSide(
          currentUser,
          updates
        );
        if (serverUpdate.ok && serverUpdate.profile) {
          setProfile(serverUpdate.profile);
          return {
            ok: true,
            message: 'Your institutional profile changes have been saved.',
          };
        }

        dataClient = createSupabaseFirebaseDataClient(async () =>
          currentUser.getIdToken(false)
        );
      }

      if (!dataClient) {
        return {
          ok: false,
          code: 'SUPABASE_NOT_CONFIGURED',
          message: 'Supabase database client is not available.',
        };
      }

      const repo = createSupabaseProfileRepository(dataClient);
      const updated = await updateOwnAppProfile(profile, updates, repo);
      setProfile(updated);

      return {
        ok: true,
        message: 'Your institutional profile changes have been saved.',
      };
    } catch (error) {
      return {
        ok: false,
        code: 'PROFILE_UPDATE_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update profile.',
      };
    }
  };

  const signInDemoAccount = useCallback(async (role: ActorRole): Promise<AuthActionResult> => {
    const demo =
      INSTITUTIONAL_DEMO_ACCOUNTS.find((d) => d.role === role) ||
      INSTITUTIONAL_DEMO_ACCOUNTS[0];

    const demoProfile: AppProfile = {
      id: `demo-${demo.role}`,
      auth_provider: 'institutional_email',
      auth_uid: `uid-demo-${demo.role}`,
      verified_email: demo.email,
      display_name: demo.displayName,
      actor_role: demo.role,
      department: demo.department,
      office_or_cohort: demo.badge,
      email_verified: true,
      is_active: true,
      created_at: '2026-09-01T12:00:00+05:30',
      updated_at: new Date().toISOString(),
    };

    localStorage.setItem(
      'campusresolve_demo_profile',
      JSON.stringify(demoProfile)
    );
    setProfile(demoProfile);
    setActiveProvider('institutional_email');
    setStatus('authenticated');

    return {
      ok: true,
      message: `Signed in as ${demo.label}. Workspace role view has been activated.`,
    };
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem('campusresolve_demo_profile');
    const supabase = getSupabaseAuthClient();
    const fbBundle = getFirebaseAuthClient();

    await Promise.allSettled([
      supabase ? supabase.auth.signOut() : Promise.resolve(),
      fbBundle ? firebaseSignOut(fbBundle.auth) : Promise.resolve(),
    ]);

    setProfile(null);
    setActiveProvider(null);
    setWelcomeEmailNotice(null);
    setAuthWarning(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        profile,
        activeProvider,
        envStatus,
        welcomeEmailNotice,
        authWarning,
        dismissNotices,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signInDemoAccount,
        requestPasswordReset,
        updatePassword,
        updateProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
