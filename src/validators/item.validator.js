// backend/src/validators/item.validator.js
const { z } = require('zod');

const validCategories = ['plastico', 'papel', 'vidrio', 'metal', 'textil', 'electronico', 'otro', 'madera', 'especiales', 'organicos'];
const validStates = ['sin_procesar', 'en_proceso', 'fardado', 'validado'];

const createItemSchema = z.object({
  title: z.string({ required_error: 'El título es obligatorio.' })
    .trim()
    .min(3, 'El título debe tener al menos 3 caracteres.')
    .max(120, 'El título no puede exceder 120 caracteres.'),
  description: z.string().trim().max(1000, 'La descripción no puede exceder 1000 caracteres.').optional().default(''),
  category: z.enum(validCategories, {
    errorMap: () => ({ message: `Categoría inválida. Opciones: ${validCategories.join(', ')}.` })
  }),
  address: z.string().trim().max(250).optional().default(''),
  lat: z.coerce.number({ required_error: 'La latitud es requerida.' })
    .min(-90, 'Latitud debe estar entre -90 y 90.')
    .max(90, 'Latitud debe estar entre -90 y 90.'),
  lng: z.coerce.number({ required_error: 'La longitud es requerida.' })
    .min(-180, 'Longitud debe estar entre -180 y 180.')
    .max(180, 'Longitud debe estar entre -180 y 180.'),
  isFree: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return true;
    if (typeof val === 'string') return val === 'true' || val === '1';
    return Boolean(val);
  }, z.boolean()).default(true),
  price: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return 0;
    return Number(val);
  }, z.number().min(0, 'El precio no puede ser negativo.')).default(0)
}).superRefine((data, ctx) => {
  if (data.isFree) {
    if (data.price !== undefined && data.price !== null && data.price > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si la publicación es gratis, el precio debe ser 0.',
        path: ['price']
      });
    }
  } else {
    if (data.price === undefined || data.price === null || data.price <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si la publicación no es gratis, el precio debe ser mayor a 0.',
        path: ['price']
      });
    }
  }
});

const updateItemSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(validCategories).optional(),
  address: z.string().trim().max(250).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  keepImages: z.union([z.string(), z.array(z.string())]).optional(),
  isFree: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'string') return val === 'true' || val === '1';
    return Boolean(val);
  }, z.boolean()).optional(),
  price: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    return Number(val);
  }, z.number().min(0, 'El precio no puede ser negativo.')).optional()
}).superRefine((data, ctx) => {
  if (data.isFree !== undefined) {
    if (data.isFree && data.price !== undefined && data.price > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si la publicación es gratis, el precio debe ser 0.',
        path: ['price']
      });
    }
    if (!data.isFree && data.price !== undefined && data.price <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si la publicación no es gratis, el precio debe ser mayor a 0.',
        path: ['price']
      });
    }
  }
});

const searchItemsQuerySchema = z.object({
  query: z.string().trim().optional(),
  category: z.enum(validCategories).optional(),
  processingState: z.string().trim().refine(
    (val) => {
      const parts = val.split(',').map(s => s.trim());
      return parts.every(part => validStates.includes(part));
    },
    { message: `Estado(s) de procesamiento inválido(s). Opciones válidas: ${validStates.join(', ')}.` }
  ).optional(),
  ownerId: z.string().trim().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

module.exports = {
  createItemSchema,
  updateItemSchema,
  searchItemsQuerySchema
};
