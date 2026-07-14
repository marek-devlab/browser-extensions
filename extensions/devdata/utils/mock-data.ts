import type {
  ConversionResult,
  JwtDecoded,
  ParsedDoc,
  ParseError,
  SchemaError,
  TreeRow,
} from './types';

// Fabricated, realistic fixtures so every scaffold surface renders "alive".
//
// EVERY screen that shows this data also renders <MockBadge/> — the point of the
// mock helpers (see @blur/ui/mock.ts) is that fabricated content is never
// mistaken for a working feature (the adblock "48 907" fake-number bug the whole
// convention exists to prevent). Remove per surface as the real logic lands.

const TREE_ROWS: TreeRow[] = [
  { id: 'r0', depth: 0, kind: 'object', key: null, preview: '{…}', count: 14, path: '$', expandable: true },
  { id: 'r1', depth: 1, kind: 'array', key: 'users', preview: '[…]', count: 120, path: '$.users', expandable: true },
  { id: 'r2', depth: 2, kind: 'object', key: '0', preview: '{…}', count: 7, path: '$.users[0]', expandable: true },
  { id: 'r3', depth: 2, kind: 'object', key: '1', preview: '{…}', count: 7, path: '$.users[1]', expandable: true },
  { id: 'r4', depth: 3, kind: 'number', key: 'id', preview: '12345678901234567890', count: null, path: '$.users[1].id', expandable: false },
  { id: 'r5', depth: 3, kind: 'string', key: 'name', preview: '"Иван"', count: null, path: '$.users[1].name', expandable: false },
  { id: 'r6', depth: 3, kind: 'bool', key: 'active', preview: 'true', count: null, path: '$.users[1].active', expandable: false },
  { id: 'r7', depth: 3, kind: 'array', key: 'roles', preview: '["admin", "dev"]', count: 2, path: '$.users[1].roles', expandable: true },
  { id: 'r8', depth: 3, kind: 'null', key: 'meta', preview: 'null', count: null, path: '$.users[1].meta', expandable: false },
  { id: 'r9', depth: 2, kind: 'object', key: '2', preview: '{…}', count: 7, path: '$.users[2]', expandable: true },
  { id: 'r10', depth: 1, kind: 'object', key: 'meta', preview: '{…}', count: 3, path: '$.meta', expandable: true },
];

const TEXT_LINES: string[] = [
  '{',
  '  "users": [',
  '    {',
  '      "id": 12345678901234567890,',
  '      "name": "Иван",',
  '      "active": true,',
  '      "roles": ["admin", "dev"],',
  '      "meta": null',
  '    },',
  '    …',
  '  ],',
  '  "meta": { "version": "1.0", "count": 120 }',
  '}',
];

/** A healthy parsed JSON document for the Data tab OK state (design §2.4). */
export const MOCK_PARSED_DOC: ParsedDoc = {
  format: 'json',
  autodetected: true,
  bytes: 1_258_291,
  lines: 18_412,
  nodes: 41_289,
  valid: true,
  rows: TREE_ROWS,
  textLines: TEXT_LINES,
};

/** The value-inspector example: a number that cannot survive a JS double. */
export const MOCK_INSPECTED = {
  path: '$.users[1].id',
  raw: '12345678901234567890',
  precisionNote:
    'Число не помещается в double. Показано исходное написание из документа; JavaScript округлил бы его до 12345678901234567000.',
};

/** The malformed-JSON error state with a position and fixes (design §5.4). */
export const MOCK_PARSE_ERROR: ParseError = {
  message: 'Ожидалось имя свойства или «}», найдено «,»',
  line: 14,
  column: 26,
  suggestions: ['Убрать лишнюю запятую', 'Разобрать как JSON5', 'Разобрать как JSONC'],
  partial: TREE_ROWS.slice(0, 4),
};

/** A JSON→YAML conversion with the mandatory lossy-conversion warnings (§2.5). */
export const MOCK_CONVERSION: ConversionResult = {
  from: 'json',
  to: 'yaml',
  text: [
    'users:',
    '  - id: 12345678901234567890',
    '    name: Иван',
    '    active: true',
    '    roles:',
    '      - admin',
    '      - dev',
  ].join('\n'),
  warnings: [
    { severity: 'warn', message: 'CSV пропущен: документ не является плоским массивом объектов.' },
    { severity: 'warn', message: 'XML: ключ «2fa» не может быть именем тега (начинается с цифры) → «_2fa».' },
    { severity: 'warn', message: 'YAML: строка «yes» будет прочитана как boolean парсерами YAML 1.1.' },
  ],
};

// A FAKE token (design §5.7: the JWT empty state must ship a fake token so users
// never paste a real credential to try the tool). This is not a real secret.
export const MOCK_JWT_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjIwMjYtMDYifQ.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ItCY0LLQsNC9IiwiaWF0IjoxNzUyNDUxMjAwLCJleHAiOjE3NTI0NTQ4MDB9.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

export const MOCK_JWT_DECODED: JwtDecoded = {
  header: { alg: 'RS256', typ: 'JWT', kid: '2026-06' },
  payload: { sub: '1234567890', name: 'Иван', iat: 1_752_451_200, exp: 1_752_454_800 },
  headerText: '{\n  "alg": "RS256",\n  "typ": "JWT",\n  "kid": "2026-06"\n}',
  payloadText:
    '{\n  "sub": "1234567890",\n  "name": "Иван",\n  "iat": 1752451200,\n  "exp": 1752454800\n}',
  alg: 'RS256',
  algNone: false,
  claims: [
    { name: 'iat', label: 'Выпущен', value: '2026-07-14 00:00:00 UTC', note: '2 часа назад', status: 'info' },
    { name: 'exp', label: 'Истекает', value: '2026-07-14 01:00:00 UTC', note: '⛔ ПРОСРОЧЕН на 1 ч 4 мин', status: 'poor' },
    { name: 'nbf', label: 'Действует с', value: '—', note: null, status: 'info' },
    { name: 'sub', label: 'Субъект', value: '1234567890', note: null, status: 'ok' },
    { name: 'aud', label: 'Аудитория', value: '—', note: null, status: 'info' },
  ],
  segments: { header: [0, 56], payload: [57, 172], signature: [173, 216] },
};

/** JSON Schema validation results for the Schema tab OK-with-errors state (§2.8). */
export const MOCK_SCHEMA_ERRORS: SchemaError[] = [
  {
    instancePath: '$.users[1].age',
    message: 'Ожидался integer, получено "тридцать"',
    schemaPath: '#/properties/users/items/properties/age/type',
  },
  {
    instancePath: '$.users[4]',
    message: 'Отсутствует обязательное свойство «id»',
    schemaPath: '#/properties/users/items/required',
  },
  {
    instancePath: '$.meta.version',
    message: 'Не соответствует pattern ^\\d+\\.\\d+$',
    schemaPath: '#/properties/meta/properties/version/pattern',
  },
];

export const MOCK_SCHEMA_TEXT = [
  '{',
  '  "type": "object",',
  '  "properties": {',
  '    "users": { "type": "array" }',
  '  },',
  '  "required": ["users"]',
  '}',
].join('\n');
