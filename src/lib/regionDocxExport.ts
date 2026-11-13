/**
 * Експорт плану реагування на область за шаблоном
 * `template/region_accident-response-plan.docx`.
 *
 * Особливості шаблону:
 * - `{region}` на першій сторінці заповнюється доменним підписом області;
 * - таблиця «КОНТАКТНИЙ ЛИСТ ЛІКАРНІ» повторюється для кожного закладу,
 *   відібраного за вибраною областю.
 *
 * Шаблон не змінюється на диску: перед рендерингом у `word/document.xml`
 * тимчасово додаються теги циклу `{#facilities}` / `{/facilities}` навколо
 * контактного листа. Це дозволяє використовувати наявний файл без ручного
 * редагування Word.
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { saveAs } from 'file-saver';
import type { FacilityRecord, FacilitySchema } from '../types';
import {
  extractFacilityData,
  loadLocalTemplate,
  type FacilityTemplateData,
} from './docxExport';
import { readFacilityRegion } from './facilityRegion';
import { formatDate, todayIso } from './format';

const CONTACT_SHEET_TITLE = 'КОНТАКТНИЙ ЛИСТ ЛІКАРНІ';
const LOOP_OPEN = '{#facilities}';
const LOOP_CLOSE = '{/facilities}';

export interface RegionTemplateData {
  current_year: string;
  region: string;
  status_date: string;
  created_by_medic: string;
  facilities: FacilityTemplateData[];
}

export interface ExportRegionPlanOptions {
  /** Доменний підпис вибраної області (не код домену). */
  region: string;
  /** Заклади, відібрані за вибраною областю. */
  facilities: FacilityRecord[];
  /** Схема шару — потрібна для перетворення кодів області на підписи. */
  schema?: FacilitySchema | null;
  /** Шлях до локального шаблону .docx. */
  templatePath: string;
}

/** Готує дані для шаблону плану області. */
export function prepareRegionTemplateData(
  region: string,
  facilities: FacilityRecord[],
  schema?: FacilitySchema | null,
): RegionTemplateData {
  const first = facilities[0];
  const regionLabel = (first ? readFacilityRegion(first, schema) : '') || region;

  return {
    current_year: String(new Date().getFullYear()),
    region: regionLabel,
    status_date: formatDate(todayIso(), ''),
    // Підпис залишаємо порожнім: документ можна підписати після друку.
    created_by_medic: '',
    facilities: facilities.map((facility) => extractFacilityData(facility)),
  };
}

/** Додає навколо контактного листа цикл Docxtemplater. */
function injectFacilityLoop(zip: PizZip): void {
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('У шаблоні немає word/document.xml.');
  }

  let xml = documentFile.asText();
  if (xml.includes(LOOP_OPEN)) return;

  const marker = xml.indexOf(CONTACT_SHEET_TITLE);
  if (marker === -1) {
    throw new Error(
      `У шаблоні не знайдено таблицю «${CONTACT_SHEET_TITLE}». Перевірте файл шаблону.`,
    );
  }

  const before = xml.slice(0, marker);
  const headingStart = Math.max(
    before.lastIndexOf('<w:p '),
    before.lastIndexOf('<w:p>'),
  );
  const tableEnd = xml.indexOf('</w:tbl>', marker);
  if (headingStart === -1 || tableEnd === -1) {
    throw new Error('Не вдалося визначити межі таблиці контактного листа у шаблоні.');
  }

  const tableClose = tableEnd + '</w:tbl>'.length;
  const tagParagraph = (value: string) =>
    `<w:p><w:r><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;

  xml =
    xml.slice(0, headingStart) +
    tagParagraph(LOOP_OPEN) +
    xml.slice(headingStart, tableClose) +
    tagParagraph(LOOP_CLOSE) +
    xml.slice(tableClose);

  zip.file('word/document.xml', xml);
}

/**
 * Завантажує шаблон, повторює контактні листи для кожного закладу
 * та зберігає готовий DOCX.
 */
export async function exportRegionResponsePlan({
  region,
  facilities,
  schema,
  templatePath,
}: ExportRegionPlanOptions): Promise<void> {
  if (facilities.length === 0) {
    throw new Error('Для вибраної області немає медичних закладів.');
  }

  const templateBuffer = await loadLocalTemplate(templatePath);
  const zip = new PizZip(templateBuffer);
  injectFacilityLoop(zip);

  const data = prepareRegionTemplateData(region, facilities, schema);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render(data);

  const blob = doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  const safeRegion = region
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .trim();
  const filename = `CASEVAC_plan_${safeRegion || 'region'}_${todayIso()}.docx`;
  saveAs(blob, filename);
}
