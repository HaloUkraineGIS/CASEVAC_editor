/**
 * Єдине джерело налаштувань застосунку.
 *
 * Значення за замовчуванням відповідають ТЗ. Їх можна перевизначити змінними
 * середовища Vite (див. .env.example), не змінюючи код.
 *
 * У файлі немає секретів: Client ID — публічний ідентифікатор OAuth-застосунку,
 * Client Secret не використовується (потік PKCE).
 */

export type AuthMode = 'demo' | 'portal';

const env = import.meta.env;

const DEFAULT_PORTAL_URL = 'https://gis.htgoims.org/portal';
const DEFAULT_CLIENT_ID = 'UkLjSBHNNooE1jnb';
const DEFAULT_WEBMAP_ID = 'f5c528f766ec467c9d7388787bc58698';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Адреса, на яку Portal повертає користувача після входу. */
function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173/';
  return `${window.location.origin}${window.location.pathname}`;
}

export const appConfig = {
  version: '0.2.8',

  /**
   * 'demo'  — локальні демонстраційні дані, вхід не потрібен (типово для розробки);
   * 'portal' — реальний вхід через ArcGIS Enterprise Portal і читання шарів.
   */
  authMode: (env.VITE_AUTH_MODE === 'portal' ? 'portal' : 'demo') as AuthMode,

  portalUrl: trimTrailingSlash(env.VITE_PORTAL_URL ?? DEFAULT_PORTAL_URL),

  oauth: {
    clientId: env.VITE_OAUTH_CLIENT_ID ?? DEFAULT_CLIENT_ID,
    redirectUri: env.VITE_OAUTH_REDIRECT_URI ?? defaultRedirectUri(),
    /** TTL токена в хвилинах, який запитуємо в Portal. */
    expirationMinutes: 480,
  },

  webMapId: env.VITE_WEBMAP_ID ?? DEFAULT_WEBMAP_ID,

  services: {
    minefields: {
      title: 'task Minefield BAC CB',
      url: 'https://gis-services.htgoims.org/arcgis/rest/services/ukraine/ukr_gis_task_mf_bac_cb/MapServer/0',
      editable: false,
    },
    routes: {
      title: 'Casevac route',
      url: 'https://gis-services.htgoims.org/arcgis/rest/services/ukraine/ukr_CASEVAC_routes_medical_facilities/FeatureServer/1',
      editable: true,
    },
    facilities: {
      title: 'Medical facilities',
      url: 'https://gis-services.htgoims.org/arcgis/rest/services/ukraine/ukr_CASEVAC_routes_medical_facilities/FeatureServer/0',
      editable: true,
    },
    startPoints: {
      title: 'Start evac point',
      url: 'https://gis.htgoims.org/server/rest/services/Ukraine/ukr_start_evac_point/MapServer/0',
      /** Запис неможливий: шар опублікований як MapServer. Потрібен FeatureServer. */
      editable: false,
    },
  },

  validation: {
    /** Максимальна відстань від кінця лінії до поля/закладу, метри. */
    routeEndpointToleranceMeters: 500,
  },

  facilities: {
    /** Через скільки місяців без візиту заклад позначається як «потрібен візит». */
    visitStaleMonths: 6,
  },

  /**
   * Назви полів у сервісах. Уточнюються після отримання Додатка А та доступу
   * до метаданих шарів. Провайдер даних додатково перевіряє альтернативні назви.
   */
  fields: {
    routes: {
      taskId: 'task_id',
      taskCode: 'task_code',
      facilityGuid: 'med_facility_guid',
      routeType: 'route_type',
      isCurrent: 'is_current',
      surveyedBy: 'surveyed_by',
      surveyDate: 'survey_date',
    },
    facilities: {
      name: 'name',
      type: 'facility_type',
      address: 'address',
      departments: 'departments',
      lastVisitDate: 'last_visit_date',
      visitedBy: 'visited_by',
    },
    startPoints: {
      parentGuid: 'parentglobalid',
    },
  },
} as const;

export type AppConfig = typeof appConfig;
