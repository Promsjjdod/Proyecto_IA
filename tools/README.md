# Declarative tool packs

Drop a JSON file here to register an HTTP tool without writing code. Packs are
loaded at backend start and run through the exact same permission + approval
pipeline as built-in tools.

```json
{
  "id": "my_tool",
  "kind": "http",
  "description": "What the tool does (shown to the model and in the UI).",
  "permissions": ["NETWORK_ACCESS"],
  "dangerous": false,
  "enabled": true,
  "input": [
    { "name": "query", "type": "string", "description": "Search terms", "optional": false }
  ],
  "endpoint": {
    "method": "GET",
    "url": "https://example.com/search?q={{query}}",
    "headers": { "Accept": "application/json" },
    "body": "{\"q\": \"{{query}}\"}"
  }
}
```

- `{{field}}` placeholders are URL-encoded and substituted from tool arguments.
- `permissions` follow the global groups: READ_FILES, WRITE_FILES,
  EXECUTE_COMMANDS, NETWORK_ACCESS, GITHUB_ACCESS.
- `dangerous: true` forces a user confirmation dialog on every call.
- Set `"enabled": false` to keep a pack on disk without registering it.
