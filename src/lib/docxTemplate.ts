/**
 * Спільне налаштування Docxtemplater для всіх DOCX-експортів.
 *
 * Два захисти від «сміття» в документах:
 * 1. `nullGetter: () => ''` — відсутній ключ рендериться порожнім рядком,
 *    а не буквальним «undefined» (це поведінка Docxtemplater за замовчуванням).
 * 2. Тримінг імен тегів — плейсхолдери виду `{ rayon_ukr}` (із зайвим
 *    пробілом, як було в першій версії шаблону) зіставляються з ключем
 *    `rayon_ukr`. Цикли `{#facilities}` працюють як раніше: модуль циклу
 *    передає парсеру вже очищене ім'я.
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

/** Парсер тегів: як стандартний, але ігнорує пробіли навколо імені. */
function trimmingParser(tag: string): { get: (scope: unknown) => unknown } {
  const key = tag.trim();
  return {
    get(scope: unknown) {
      if (key === '.') return scope;
      if (scope !== null && typeof scope === 'object') {
        // Підтримуємо і прості ключі, і вкладені шляхи виду `a.b`.
        const parts = key.split('.');
        let value: unknown = scope;
        for (const part of parts) {
          if (value === null || value === undefined) return value;
          value = (value as Record<string, unknown>)[part];
        }
        return value;
      }
      return scope;
    },
  };
}

/** Docxtemplater із захистом від «undefined» і пробілів у тегах. */
export function createDocxDocument(templateBuffer: ArrayBuffer): Docxtemplater {
  return createDocxDocumentFromZip(new PizZip(templateBuffer));
}

/** Те саме, але поверх уже підготовленого zip (наприклад, з інжектованим циклом). */
export function createDocxDocumentFromZip(zip: PizZip): Docxtemplater {
  return new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
    parser: trimmingParser,
  });
}
