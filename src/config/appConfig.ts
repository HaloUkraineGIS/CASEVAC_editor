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
const DEFAULT_WEBMAP_ID = 'c9fbad0317544acfb982d52f8384bf9a';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Читає додатне число зі змінної середовища; інакше повертає типовий варіант. */
function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_ROUTING_ARCGIS_URL =
  'https://gis.htgoims.org/portal/sharing/servers/ecad41490e704f8680c3468c0b2f7c6b/rest/services/World/Route/NAServer/Route_World';

/** Адреса, на яку Portal повертає користувача після входу. */
function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173/';
  return `${window.location.origin}${window.location.pathname}`;
}

export const appConfig = {
  version: '0.5.7',

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

  /** ID елемента шаблону Word у Portal (null — завантажувати локально). */
  templateItemId: env.VITE_TEMPLATE_ITEM_ID ?? null,

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
    surveyPolygons: {
      title: 'Survey polygons',
      url: 'https://gis-services.htgoims.org/arcgis/rest/services/ukraine/ukr_gis_survey_polygons/MapServer',
      editable: false,
    },
    cbSurveyPolygons: {
      title: 'CB survey polygons',
      url: 'https://gis-services.htgoims.org/arcgis/rest/services/ukraine/ukr_confidence_building_survey_polygons/MapServer',
      editable: false,
    },
    frontline: {
      title: 'Frontline',
      url: 'https://gis.htgoims.org/server/rest/services/Hosted/isw/FeatureServer/0',
      editable: false,
    },
    startPoints: {
      title: 'Start evac point',
      url: 'https://gis.htgoims.org/server/rest/services/Ukraine/ukr_start_evac_point/MapServer/0',
      /** Запис неможливий: шар опублікований як MapServer. Потрібен FeatureServer. */
      editable: false,
    },
  },

  routing: {
    /**
     * 'arcgis' — Network Analysis на Portal (основний варіант);
     * 'osrm'   — публічний або власний OSRM (для демо/розробки).
     */
    provider: (env.VITE_ROUTING_PROVIDER === 'osrm' ? 'osrm' : 'arcgis') as 'arcgis' | 'osrm',
    arcgisUrl: trimTrailingSlash(env.VITE_ROUTING_ARCGIS_URL ?? DEFAULT_ROUTING_ARCGIS_URL),
    osrmUrl: trimTrailingSlash(env.VITE_ROUTING_OSRM_URL ?? 'https://router.project-osrm.org'),
    timeoutMs: numberEnv(env.VITE_ROUTING_TIMEOUT_MS, 12_000),
    /** Допуск спрощення геометрії, метри. */
    simplifyToleranceMeters: numberEnv(env.VITE_ROUTING_SIMPLIFY_METERS, 20),
  },

  validation: {
    /** Максимальна відстань від кінця лінії до поля/закладу, метри. */
    routeEndpointToleranceMeters: 500,
  },

  facilities: {
    /**
     * Через скільки місяців без візиту заклад позначається як «потрібен візит».
     * Один місяць — єдиний поріг для карток «Перевірені» й «Потрібен візит».
     */
    visitStaleMonths: 1,
  },

  /**
   * Назви полів у сервісах. Уточнюються після отримання Додатка А та доступу
   * до метаданих шарів. Провайдер даних додатково перевіряє альтернативні назви.
   */
  fields: {
    routes: {
      taskId: 'task_id',
      taskCode: 'task_code',
      taskName: 'task_name',
      facilityGuid: 'med_facility_guid',
      isCurrent: 'is_current',
      surveyedBy: 'surveyed_by',
      surveyDate: 'survey_date',
      createdAt: 'created_date',
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
