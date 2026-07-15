// Example documents. These are NOT mocks: they are real inputs, parsed by the
// real pipeline, and they exist so a user can understand the tool WITHOUT
// pasting a genuine credential into it (design §2.3, §5.7).
//
// The JWT example is a deliberately FAKE token: its signature is nonsense, so
// "verify" honestly fails on it. That is the point — a working example token
// would teach people to paste real ones.

export const EXAMPLE_JSON = `{
  "users": [
    {
      "id": 12345678901234567890,
      "name": "Иван",
      "active": true,
      "roles": ["admin", "dev"],
      "meta": null
    },
    {
      "id": 2,
      "name": "Anna 👩‍💻",
      "active": false,
      "roles": [],
      "meta": { "seen": "2026-07-01" }
    }
  ],
  "meta": { "version": "1.0", "count": 2 }
}`;

export const EXAMPLE_YAML = `# YAML 1.2
users:
  - id: 12345678901234567890
    name: Иван
    active: yes        # ⚠ YAML 1.1 читает это как boolean
    roles: [admin, dev]
    meta: ~
  - id: 2
    name: Anna
    active: false
    roles: []
meta:
  version: "1.0"
  count: 2
`;

export const EXAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<users>
  <user id="1">
    <name>Иван</name>
    <roles>
      <role>admin</role>
      <role>dev</role>
    </roles>
  </user>
  <user id="2">
    <name>Anna</name>
    <roles/>
  </user>
</users>`;

export const EXAMPLE_CSV = `id,name,active,roles
1,Иван,true,"admin,dev"
2,Anna,false,
3,"Петров, Пётр",true,dev
`;

/** A FAKE JWT. The signature is not a real signature — verification will fail,
 *  and that is honest. Never ship an example token that verifies. */
export const EXAMPLE_JWT =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjIwMjYtMDYifQ.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ItCY0LLQsNC9IiwiaWF0IjoxNzUyNDUxMjAwLCJleHAiOjE3NTI0NTQ4MDB9.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

export const EXAMPLE_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["users"],
  "properties": {
    "users": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "integer" },
          "name": { "type": "string", "minLength": 1 },
          "active": { "type": "boolean" }
        }
      }
    },
    "meta": {
      "type": "object",
      "properties": {
        "version": { "type": "string", "pattern": "^\\\\d+\\\\.\\\\d+$" }
      }
    }
  }
}`;
