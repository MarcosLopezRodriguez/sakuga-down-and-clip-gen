// Frontend entrypoint (esbuild bundle target)
// Initial minimal setup; we will progressively migrate logic from public/app.js

import { logger } from '../utils/logger';

(function init() {
  logger.info('Frontend bundle initialized');
  // No side-effects for now to avoid interfering with existing public/app.js
})();
