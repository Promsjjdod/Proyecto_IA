#!/bin/bash
cd "$(dirname "$0")"
(command -v python3 && python3 -m http.server 8080) || node server.js
