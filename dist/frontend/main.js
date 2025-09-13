"use strict";
// Frontend entrypoint (esbuild bundle target)
// Initial minimal setup; we will progressively migrate logic from public/app.js
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
(function init() {
    logger_1.logger.info('Frontend bundle initialized');
    // No side-effects for now to avoid interfering with existing public/app.js
})();
