/**
 * Експорт документу Word за шаблоном task_accident-response-plan.docx
 *
 * Плейсхолдери:
 * - З шару мінних полів (task Minefield BAC CB): task_code, task_name_ukr, oblast, rayon, council, locality, imsma_hazard_code
 * - З шару закладів (Medical facilities): решта 32 плейсхолдери
 * - Додаткові: current_year, created_by_medic, military_medic_group
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { saveAs } from 'file-saver';
import type { FacilityRecord, MinefieldRecord, RouteRecord } from '../types';

/** Розширений MinefieldRecord з усіма полями для шаблону. */
export interface MinefieldTemplateData {
  task_code: string;
  task_name_ukr: string;
  oblast_ukr: string;
  rayon_ukr: string;
  council_ukr: string;
  locality_ukr: string;
  imsma_hazard_code: string;
}

/** Дані закладу для шаблону (з атрибутів). */
export interface FacilityTemplateData {
  full_name_ukr: string;
  full_name_eng: string;
  type_of_hosp_ukr: string;
  type_of_hosp_eng: string;
  contact_ukr: string;
  contact_eng: string;
  address: string;
  address_eng: string;
  phone: string;
  locality: string;
  rayon: string;
  oblast: string;
  council: string;
  x: string;
  y: string;
  // Можливості закладу (departments)
  icu_ccu: string;
  surgical: string;
  orthopaedic: string;
  burn: string;
  neurological: string;
  cardiology: string;
  renal_urology: string;
  infection_disease: string;
  dental: string;
  braine_surgical: string;
  eye_injures_surgical: string;
  face_injures_surgical: string;
  // Обладнання (paraclinical)
  xray: string;
  computer_tomography: string;
  mri: string;
  ultrasound: string;
  laboratory: string;
  blood_products_available: string;
  oxygen: string;
  generator: string;
  military_medic_group: string;
}

/** Повний набір даних для заповнення шаблону. */
export interface TemplateData extends MinefieldTemplateData, FacilityTemplateData {
  current_year: string;
  created_by_medic: string;
}

/**
 * Завантажити шаблон Word з Portal.
 * @param portalUrl - адреса Portal
 * @param itemId - ID елемента типу Document у Portal
 * @param token - токен доступу користувача
 */
export async function loadTemplate(
  portalUrl: string,
  itemId: string,
  token: string,
): Promise<ArrayBuffer> {
  const url = `${portalUrl}/sharing/rest/content/items/${itemId}/data`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Не вдалося завантажити шаблон: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

/**
 * Завантажити локальний шаблон (для демо-режиму або розробки).
 */
export async function loadLocalTemplate(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Не вдалося завантажити шаблон: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

/**
 * Витягти дані мінного поля з атрибутів для шаблону.
 */
export function extractMinefieldData(
  minefield: MinefieldRecord,
  attributes: Record<string, unknown>,
): MinefieldTemplateData {
  const get = (key: string) => {
    const value = attributes[key];
    return value !== undefined && value !== null ? String(value).trim() : '';
  };

  return {
    task_code: get('task_code') || minefield.taskCode,
    task_name_ukr: get('task_name_ukr') || get('task_name') || minefield.name,
    oblast_ukr: get('oblast_ukr') || get('oblast'),
    rayon_ukr: get('rayon_ukr') || get('rayon'),
    council_ukr: get('council_ukr') || get('council'),
    locality_ukr: get('locality_ukr') || get('locality'),
    imsma_hazard_code: get('imsma_hazard_code') || get('hazard_code'),
  };
}

/**
 * Витягти дані закладу з атрибутів для шаблону.
 */
export function extractFacilityData(facility: FacilityRecord): FacilityTemplateData {
  const attrs = facility.attributes;

  const get = (key: string, fallback = '') => {
    const value = attrs[key];
    if (value === undefined || value === null) return fallback;
    const str = String(value).trim();
    return str || fallback;
  };

  // Перетворення yes/no на +/- для полів можливостей та обладнання
  const getYesNo = (key: string) => {
    const value = attrs[key];
    if (value === undefined || value === null) return '';
    const str = String(value).trim().toLowerCase();
    if (str === 'yes' || str === 'так' || str === 'true' || str === '1') return '+';
    if (str === 'no' || str === 'ні' || str === 'false' || str === '0') return '-';
    if (str === 'possible' || str === 'можливо') return '+/-';
    return str;
  };

  const location = facility.location || [0, 0];
  const phone = get('phone');
  const email = get('email');
  const contactFallback = [phone, email].filter(Boolean).join(', ');
  const contactUkr = get('contact_ukr', contactFallback);

  /**
   * У частині шарів (зокрема в демо-даних) немає окремих полів можливостей
   * та обладнання — там є лише текстові описи `departments`, `operations`,
   * `equipment`. Виводимо позначки «+»/«-» з цих описів, щоб контактний
   * лист не був порожнім. Якщо є явне поле (як у робочому шарі Portal),
   * воно має приоритет.
   */
  const splitSegments = (value: string) =>
    value
      .toLowerCase()
      .split(/[;,/]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  const clinicalSegments = splitSegments([get('departments'), get('operations')].join('; '));
  const equipmentSegments = splitSegments([get('equipment'), get('departments')].join('; '));
  const matches = (segments: string[], patterns: string[]) =>
    segments.some((segment) =>
      patterns.some((pattern) =>
        // Короткі абревіатури (КТ, МРТ) шукаємо як окремий елемент,
        // щоб не зловити випадковий збіг усередині іншого слова.
        pattern.length <= 3 ? segment === pattern || segment.startsWith(`${pattern} `) : segment.includes(pattern),
      ),
    );

  /** Явне yes/no-поле, інакше — висновок із текстового опису відділень. */
  const capability = (key: string, patterns: string[], extraKey?: string) => {
    const explicit = getYesNo(key) || (extraKey ? getYesNo(extraKey) : '');
    if (explicit) return explicit;
    if (clinicalSegments.length === 0) return '';
    return matches(clinicalSegments, patterns) ? '+' : '-';
  };

  /** Явне yes/no-поле, інакше — висновок із текстового опису обладнання. */
  const equipmentFlag = (key: string, patterns: string[], extraKey?: string) => {
    const explicit = getYesNo(key) || (extraKey ? getYesNo(extraKey) : '');
    if (explicit) return explicit;
    if (equipmentSegments.length === 0) return '';
    return matches(equipmentSegments, patterns) ? '+' : '-';
  };

  // «Хірургія» не повинна спрацьовувати на нейро-, щелепно-лицьову
  // чи офтальмологічну хірургію — для них є окремі рядки.
  const generalSurgery = (() => {
    const explicit = getYesNo('surgical');
    if (explicit) return explicit;
    if (clinicalSegments.length === 0) return '';
    const found = clinicalSegments.some(
      (segment) =>
        segment.includes('хірург') &&
        !segment.includes('нейро') &&
        !segment.includes('щелепно') &&
        !segment.includes('офтальм'),
    );
    return found ? '+' : '-';
  })();

  return {
    full_name_ukr: get('full_name_ukr', get('name_ukr', facility.name)),
    full_name_eng: get('full_name_eng', get('name_eng', facility.name)),
    type_of_hosp_ukr: get('type_of_hospital', facility.type),
    type_of_hosp_eng: get('type_of_hosp_eng', ''),
    contact_ukr: contactUkr,
    contact_eng: get('contact_eng', contactUkr),
    address: get('address', facility.address),
    address_eng: get('address_eng', ''),
    phone: get('phone', ''),
    locality: get('locality', ''),
    rayon: get('rayon', ''),
    oblast: get('oblast', get('region', '')),
    council: get('council', ''),
    x: location[0].toFixed(6),
    y: location[1].toFixed(6),
    // Можливості — явні поля або висновок із текстових описів
    icu_ccu: capability('icu_ccu', ['реанімац', 'інтенсивн'], 'has_icu'),
    surgical: generalSurgery,
    orthopaedic: capability('orthopaedic', ['ортопед', 'травматолог']),
    burn: capability('burn', ['опік', 'опіков']),
    neurological: capability('neurological', ['невролог']),
    cardiology: capability('cardiology', ['кардіолог']),
    renal_urology: capability('renal_urology', ['нефролог', 'уролог']),
    infection_disease: capability('infection_disease', ['інфекційн']),
    dental: capability('dental', ['стоматолог']),
    braine_surgical: capability('braine_surgical', ['нейрохірург', 'нейро']),
    eye_injures_surgical: capability('eye_injures_surgical', ['офтальм']),
    face_injures_surgical: capability('face_injures_surgical', ['щелепно']),
    // Обладнання — явні поля або висновок із текстових описів
    xray: equipmentFlag('xray', ['рентген'], 'has_xray'),
    computer_tomography: equipmentFlag('computer_tomography', ['комп', 'томограф', 'кт'], 'has_ct'),
    mri: equipmentFlag('mri', ['мрт', 'магнітно'], 'has_mri'),
    ultrasound: equipmentFlag('ultrasound', ['узд', 'ультразвук']),
    laboratory: equipmentFlag('laboratory', ['лаборатор']),
    blood_products_available: equipmentFlag('blood_products_available', ['кров']),
    oxygen: equipmentFlag('oxygen', ['кисень', 'кисн']),
    generator: equipmentFlag('generator', ['генератор']),
    // Медична група також перетворюється
    military_medic_group: getYesNo('military_medic_group'),
  };
}

/**
 * Підготувати повний набір даних для шаблону.
 */
export function prepareTemplateData(
  route: RouteRecord,
  minefield: MinefieldRecord,
  minefieldAttributes: Record<string, unknown>,
  facility: FacilityRecord,
): TemplateData {
  const minefieldData = extractMinefieldData(minefield, minefieldAttributes);
  const facilityData = extractFacilityData(facility);

  return {
    ...minefieldData,
    ...facilityData,
    current_year: new Date().getFullYear().toString(),
    created_by_medic: route.surveyedBy || '',
    // military_medic_group вже є в facilityData, просто перевизначаємо для ясності
    military_medic_group: facilityData.military_medic_group,
  };
}

/**
 * Згенерувати документ Word за шаблоном та завантажити його.
 *
 * @param templateBuffer - ArrayBuffer шаблону .docx
 * @param data - дані для заповнення плейсхолдерів
 * @param filename - ім'я файлу для завантаження
 */
export function generateDocument(
  templateBuffer: ArrayBuffer,
  data: TemplateData,
  filename: string,
): void {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    doc.render(data);

    const blob = doc.getZip().generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    saveAs(blob, filename);
  } catch (error) {
    console.error('Помилка генерації документу:', error);
    throw new Error(`Не вдалося згенерувати документ: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Повний цикл експорту: завантажити шаблон, заповнити і завантажити документ.
 */
export async function exportResponsePlan(
  route: RouteRecord,
  minefield: MinefieldRecord,
  minefieldAttributes: Record<string, unknown>,
  facility: FacilityRecord,
  options: {
    templatePath?: string;
    portalUrl?: string;
    templateItemId?: string;
    token?: string;
  } = {},
): Promise<void> {
  // Завантажити шаблон
  let templateBuffer: ArrayBuffer;
  if (options.templatePath) {
    templateBuffer = await loadLocalTemplate(options.templatePath);
  } else if (options.portalUrl && options.templateItemId && options.token) {
    templateBuffer = await loadTemplate(options.portalUrl, options.templateItemId, options.token);
  } else {
    throw new Error('Потрібно вказати templatePath або portalUrl + templateItemId + token');
  }

  // Підготувати дані
  const data = prepareTemplateData(route, minefield, minefieldAttributes, facility);

  // Згенерувати ім'я файлу: CASEVAC_{task_code}_{дата}.docx
  const today = new Date().toISOString().slice(0, 10);
  const filename = `CASEVAC_${route.code}_${today}.docx`;

  // Згенерувати і завантажити
  generateDocument(templateBuffer, data, filename);
}
