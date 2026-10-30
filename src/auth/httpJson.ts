/**
 * Читання JSON-відповідей Portal.
 *
 * ArcGIS REST зазвичай повертає JSON, але в разі помилки авторизації або
 * недоступності проксі може повернути HTML-сторінку (сторінку входу чи
 * сторінку помилки). Без цієї перевірки `response.json()` кидає незрозуміле
 * `SyntaxError: JSON.parse: unexpected character at line 1 column 1`.
 */

export async function readPortalJson<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();

  if (trimmed.startsWith('<')) {
    throw new Error(
      `${context}: Portal повернув HTML-сторінку замість JSON. ` +
        'Перевірте Redirect URI застосунку в Portal, сесію користувача та доступ до REST API.',
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${context}: відповідь Portal не є коректним JSON.`);
  }
}
