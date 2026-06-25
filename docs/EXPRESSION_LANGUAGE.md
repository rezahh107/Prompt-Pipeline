# PEaC Expression Language

PEaC expressions are a small configuration language used in contracts, routes, policies, and validators. They are not JavaScript.

## Supported values

- identifiers from the current input object
- string literals with single quotes, double quotes, or backticks
- number literals
- booleans: `true`, `false`
- `null`

## Supported operators

- equality: `==`, `!=`, `===`, `!==`
- comparison: `>`, `>=`, `<`, `<=`
- boolean logic: `&&`, `||`, `!`
- grouping with parentheses
- `.length` on strings and arrays

## Equality semantics

- `===` and `!==` are strict.
- `==` and `!=` use controlled loose equality only for useful config checks.
- `missing_value == null` is true when the identifier is undefined or null.
- Numeric strings can compare equal to numbers through `==` but not `===`.
- Arbitrary JavaScript coercion is not supported.

## Unsupported features

- function calls other than the validator-side `len(rendered_prompt)` preprocessor
- arithmetic
- object traversal except `.length`
- arbitrary JavaScript execution
- arrays or object literals
- regex literals

## Safety rule

Expressions must fail closed. Invalid syntax, unsupported properties, or unterminated string literals must raise validation errors rather than being treated as true.

## Test expectations

Expression self tests must cover:

- string equality
- nullish equality
- array and string length
- invalid syntax
- unterminated strings
- boolean precedence
- unsupported property access
