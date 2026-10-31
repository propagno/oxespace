/**
 * Placeholders and option names that are code, not prose: commands, SQL, JSON, field names and encodings read the same
 * in every language, so they are not in the translation catalogs.
 */
export const EXAMPLE = {
  command: 'ls -la /var/lib',
  checkExpression: 'price >= 0',
  partialIndex: 'deleted_at IS NULL',
  authSource: 'admin',
  maskedNames: 'ssn\ncard_number',
  jsonSchemaKeyword: '$jsonSchema',
  jsonSchema: '{ "$jsonSchema": { "bsonType": "object", "required": ["name"] } }'
} as const

/** Shells a container can be entered with. */
export const SHELLS = ['sh', 'bash'] as const

/** Text encodings an import can be read with, besides detecting it; the value is also its name. */
export const PLAIN_ENCODINGS = [['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE']] as const
