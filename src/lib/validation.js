export function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function text(value, name, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') fail(`${name} must be text.`);
  const result = value.trim();
  if (result.length < min || result.length > max) fail(`${name} must be ${min}-${max} characters.`);
  return result;
}
export function email(value) {
  const result = text(value, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Please provide a valid email address.');
  return result;
}
export function fields(body, specs, partial = false, allowEmpty = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required.');
  const result = {};
  for (const [key, spec] of Object.entries(specs)) {
    if (body[key] === undefined && (partial || spec.optional)) continue;
    if (spec.boolean) {
      if (typeof body[key] !== 'boolean') fail(`${key} must be a boolean.`);
      result[key] = body[key];
    } else {
      result[key] = text(body[key], key, spec);
      if (spec.values && !spec.values.includes(result[key])) fail(`Invalid ${key}.`);
    }
  }
  if (partial && !allowEmpty && !Object.keys(result).length) fail('No supported update fields supplied.');
  return result;
}
export const postFields = {
  title: { max: 200 }, excerpt: { max: 1000 }, content: { max: 100000 },
  category: { max: 100, optional: true }, author: { max: 100, optional: true },
  coverVariant: { values: ['blue', 'purple'], optional: true },
  published: { boolean: true, optional: true },
};
export const jobFields = {
  title: { max: 200 }, department: { max: 100 }, description: { max: 20000 },
  location: { max: 200, optional: true },
  type: { values: ['Full-time', 'Part-time', 'Contract', 'Internship'], optional: true },
  active: { boolean: true, optional: true },
};
