import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** Always import `z` from here so `.openapi()` is available on every schema. */
export { z };
