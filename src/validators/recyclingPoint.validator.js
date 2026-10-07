const { z } = require('zod');

const validCategories = ['plastico', 'papel', 'vidrio', 'metal', 'textil', 'electronico', 'otro', 'madera', 'especiales', 'organicos'];
const validStatuses = ['activo', 'inactivo', 'mantenimiento'];

const createRecyclingPointSchema = z.object({
  name: z.string({ required_error: 'El nombre del punto de reciclaje es obligatorio' })
    .trim()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(120, 'El nombre no puede exceder 120 caracteres'),
  description: z.string().trim().max(500).optional().default(''),
  address: z.string({ required_error: 'La dirección es obligatoria' })
    .trim()
    .min(3, 'La dirección debe tener al menos 3 caracteres')
    .max(250),
  lat: z.coerce.number({ required_error: 'La latitud es obligatoria' })
    .min(-90, 'Latitud debe estar entre -90 y 90')
    .max(90, 'Latitud debe estar entre -90 y 90'),
  lng: z.coerce.number({ required_error: 'La longitud es obligatoria' })
    .min(-180, 'Longitud debe estar entre -180 y 180')
    .max(180, 'Longitud debe estar entre -180 y 180'),
  acceptedCategories: z.array(z.enum(validCategories)).optional().default(['plastico', 'papel', 'vidrio']),
  schedule: z.string().trim().max(100).optional().default('Lunes a Viernes 08:00 a 18:00'),
  contactPhone: z.string().trim().max(30).optional().default(''),
  pinColor: z.string().trim().max(20).optional().default('#10B981'),
  pinIcon: z.string().trim().max(50).optional().default('recycle'),
  status: z.enum(validStatuses).optional().default('activo')
});

const updateRecyclingPointSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  address: z.string().trim().min(3).max(250).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  acceptedCategories: z.array(z.enum(validCategories)).optional(),
  schedule: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  pinColor: z.string().trim().max(20).optional(),
  pinIcon: z.string().trim().max(50).optional(),
  status: z.enum(validStatuses).optional()
});

module.exports = {
  createRecyclingPointSchema,
  updateRecyclingPointSchema
};
