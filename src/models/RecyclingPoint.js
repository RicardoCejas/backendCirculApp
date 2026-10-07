// backend/src/models/RecyclingPoint.js
const mongoose = require('mongoose');

const recyclingPointSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre del punto de reciclaje es obligatorio'],
    trim: true,
    maxlength: 120
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  address: {
    type: String,
    required: [true, 'La dirección es obligatoria'],
    trim: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitud, latitud]
      required: true,
      default: [0, 0]
    },
    lat: { type: Number },
    lng: { type: Number }
  },
  acceptedCategories: {
    type: [String],
    enum: ['plastico', 'papel', 'vidrio', 'metal', 'textil', 'electronico', 'otro', 'madera', 'especiales', 'organicos'],
    default: ['plastico', 'papel', 'vidrio']
  },
  schedule: {
    type: String,
    trim: true,
    default: 'Lunes a Viernes 08:00 a 18:00'
  },
  contactPhone: {
    type: String,
    trim: true
  },
  pinColor: {
    type: String,
    default: '#10B981', // Verde esmeralda por defecto
    trim: true
  },
  pinIcon: {
    type: String,
    default: 'recycle',
    trim: true
  },
  status: {
    type: String,
    enum: ['activo', 'inactivo', 'mantenimiento'],
    default: 'activo'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Sincronizar coordenadas antes de guardar
recyclingPointSchema.pre('validate', function (next) {
  if (this.location) {
    const lat = this.location.lat !== undefined ? this.location.lat : (this.location.coordinates ? this.location.coordinates[1] : 0);
    const lng = this.location.lng !== undefined ? this.location.lng : (this.location.coordinates ? this.location.coordinates[0] : 0);
    this.location.type = 'Point';
    this.location.coordinates = [lng, lat];
    this.location.lat = lat;
    this.location.lng = lng;
  }
  next();
});

// Índices espaciales y de consulta
recyclingPointSchema.index({ location: '2dsphere' });
recyclingPointSchema.index({ status: 1 });
recyclingPointSchema.index({ acceptedCategories: 1 });
recyclingPointSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RecyclingPoint', recyclingPointSchema);
