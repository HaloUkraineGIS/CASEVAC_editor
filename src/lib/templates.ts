/**
 * URL-адреси DOCX-шаблонів.
 *
 * Шаблони лежать у каталозі `template/` в корені проєкту (це їхнє єдине
 * джерело) і підключаються через `?url`, тому Vite сам копіює їх у збірку
 * з правильним базовим шляхом — і в dev, і в build. Дублювати файли
 * в `public/template/` не потрібно (застаріла копія там якраз і стала
 * причиною «undefined» у районі: застосунок читав старий файл).
 *
 * Зауваження: `vite.config.ts` ігнорує `template/**` у watch (файли можуть
 * бути заблоковані Word), тому після правки шаблону dev-сервер треба
 * перезапустити вручну.
 */

import regionTemplateUrl from '../../template/region_accident-response-plan.docx?url';
import taskTemplateUrl from '../../template/task_accident-response-plan.docx?url';

/** Шаблон плану реагування маршруту CASEVAC. */
export const TASK_TEMPLATE_URL = taskTemplateUrl;

/** Шаблон плану реагування на область. */
export const REGION_TEMPLATE_URL = regionTemplateUrl;
