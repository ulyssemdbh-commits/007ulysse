#!/bin/bash
set -e
npm install
yes "" | npm run db:push || true
