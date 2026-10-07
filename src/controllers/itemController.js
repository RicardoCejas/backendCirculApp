// backend/src/controllers/itemController.js
const Item = require('../models/Item');
const User = require('../models/User');
const { deleteFromCloudinary } = require('../utils/cloudinary');
const notificationService = require('../services/notificationService');

// Crear un nuevo ítem (RF03)
const createItem = async (req, res) => {
  try {
    const { title, description, category, lat, lng, address, isFree, price } = req.body;

    // Convertir y validar coordenadas
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ msg: 'Coordenadas de geolocalización inválidas (Latitud [-90, 90], Longitud [-180, 180]).' });
    }

    // Procesar imágenes subidas (Cloudinary o Disco Local)
    const imageUrls = req.files ? req.files.map(f => {
      // Multer-storage-cloudinary proporciona la URL completa en f.path o f.secure_url
      if (f.path && (f.path.startsWith('http://') || f.path.startsWith('https://'))) {
        return f.path;
      }
      if (f.secure_url) {
        return f.secure_url;
      }
      if (f.filename) {
        return `${req.protocol}://${req.get('host')}/uploads/items/${f.filename}`;
      }
      return f.path || f.url;
    }) : [];

    const isFreeBool = isFree !== undefined ? Boolean(isFree) : true;
    const priceNum = !isFreeBool ? (Number(price) || 0) : 0;

    const newItem = new Item({
      title,
      description,
      category,
      address: address ? address.trim() : '',
      isFree: isFreeBool,
      price: priceNum,
      location: {
        type: 'Point',
        coordinates: [lngNum, latNum]
      },
      ownerId: req.user.id,
      images: imageUrls,
      processingState: 'sin_procesar' // Estado inicial
    });

    await newItem.save();

    // Disparar alertas de proximidad a usuarios y gestores de forma asíncrona
    notificationService.notifyNearbyUsersOnPublish({
      item: newItem,
      authorId: req.user.id
    }).catch(err => console.error('Error al emitir alertas de proximidad:', err));

    res.status(201).json(newItem);
  } catch (err) {
    console.error('Error en createItem:', err);
    res.status(500).json({ msg: 'Error al crear el ítem.' });
  }
};

// Buscar ítems con filtros avanzados (RF04, RF13) y búsqueda geoespacial nativa en MongoDB
const searchItems = async (req, res) => {
  try {
    const { 
      query, 
      category, 
      processingState, 
      lat, 
      lng, 
      radius,
      ownerId 
    } = req.query;

    let filter = {};

    // Filtro por dueño (para perfil de usuario)
    if (ownerId) {
      filter.ownerId = ownerId;
    }

    // Filtro por estado de procesamiento (RF15, P-036)
    if (processingState) {
      if (typeof processingState === 'string' && processingState.includes(',')) {
        const states = processingState.split(',').map(s => s.trim()).filter(Boolean);
        filter.processingState = { $in: states };
      } else {
        filter.processingState = processingState;
      }
    }

    // Búsqueda por texto (sanitizado contra ReDoS)
    if (query && typeof query === 'string') {
      const sanitizedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (sanitizedQuery.length > 0) {
        filter.$or = [
          { title: { $regex: sanitizedQuery, $options: 'i' } },
          { description: { $regex: sanitizedQuery, $options: 'i' } }
        ];
      }
    }

    // Filtro por categoría (sanitizado como string)
    if (category && typeof category === 'string') filter.category = category;

    // Filtro geoespacial nativo de MongoDB (índice 2dsphere con $geoWithin $centerSphere)
    if (lat && lng && radius) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const radiusKm = parseFloat(radius);

      if (!isNaN(latNum) && !isNaN(lngNum) && !isNaN(radiusKm) && radiusKm > 0) {
        const radiusInRadians = radiusKm / 6378.1; // Radio terrestre en kilómetros
        filter.location = {
          $geoWithin: {
            $centerSphere: [[lngNum, latNum], radiusInRadians]
          }
        };
      }
    }

    // P-030: Si se busca por un ownerId específico, validar que no esté inactivo
    if (filter.ownerId) {
      const targetUser = await User.findById(filter.ownerId).select('active');
      if (targetUser && targetUser.active === false) {
        return res.json(req.query.format === 'paginated' ? { items: [], total: 0, page: 1, totalPages: 0, limit: 50, hasMore: false } : []);
      }
    }

    // Paginación y ordenamiento eficientes en el motor de base de datos
    const pageNum = parseInt(req.query.page, 10) || 1;
    const limitNum = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const skip = (pageNum - 1) * limitNum;

    // Obtener ítems paginados directamente de MongoDB sin exponer PII (email / teléfono)
    const [total, rawItems] = await Promise.all([
      Item.countDocuments(filter),
      Item.find(filter)
        .populate('ownerId', 'name location active')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
    ]);

    // Filtrar publicaciones cuyos dueños fueron desactivados
    const items = rawItems.filter(item => item.ownerId && item.ownerId.active !== false);
    const totalPages = Math.ceil(total / limitNum) || 1;

    res.set('X-Total-Count', total.toString());
    res.set('X-Total-Pages', totalPages.toString());
    res.set('X-Current-Page', pageNum.toString());

    if (req.query.format === 'paginated') {
      return res.json({
        items,
        total,
        page: pageNum,
        totalPages,
        limit: limitNum,
        hasMore: pageNum < totalPages
      });
    }

    res.json(items);
  } catch (err) {
    console.error('Error en searchItems:', err);
    res.status(500).json({ msg: 'Error al buscar ítems.' });
  }
};

// Actualizar un ítem (solo dueño o admin)
const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, address, lat, lng, keepImages, isFree, price } = req.body;

    const item = await Item.findById(id);
    if (!item) return res.status(404).json({ msg: 'Ítem no encontrado.' });

    // Verificar permisos estrictos: solo el autor original o un administrador
    const currentUserId = req.user?.id || req.user?._id;
    const isOwner = item.ownerId && currentUserId && item.ownerId.toString() === currentUserId.toString();
    const isAdmin = req.user?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ msg: 'No tienes permiso para editar este material. Solo el autor o un administrador pueden modificarlo.' });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (address !== undefined) updateData.address = address;
    if (isFree !== undefined) {
      updateData.isFree = Boolean(isFree);
      if (updateData.isFree) {
        updateData.price = 0;
      } else if (price !== undefined) {
        updateData.price = Number(price) || 0;
      }
    } else if (price !== undefined) {
      updateData.price = Number(price) || 0;
    }
    if (lat !== undefined && lng !== undefined) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (!isNaN(latNum) && !isNaN(lngNum) && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180) {
        updateData.location = {
          type: 'Point',
          coordinates: [lngNum, latNum],
          lat: latNum,
          lng: lngNum
        };
      } else {
        return res.status(400).json({ msg: 'Coordenadas de geolocalización inválidas.' });
      }
    }

    // Manejo inteligente de imágenes conservadas vs eliminadas
    let finalImages = [];
    let imagesToDelete = [];
    if (keepImages !== undefined) {
      const keepArr = Array.isArray(keepImages) ? keepImages.filter(Boolean) : (keepImages ? [keepImages] : []);
      finalImages = (item.images || []).filter(img => keepArr.includes(img));
      imagesToDelete = (item.images || []).filter(img => !keepArr.includes(img));
    } else {
      finalImages = item.images || [];
    }

    // Subir nuevas imágenes enviadas (Cloudinary o Disco Local)
    if (req.files && req.files.length > 0) {
      const newUrls = req.files.map(file => {
        if (file.path && (file.path.startsWith('http://') || file.path.startsWith('https://'))) {
          return file.path;
        }
        if (file.secure_url) {
          return file.secure_url;
        }
        if (file.filename) {
          return `${req.protocol}://${req.get('host')}/uploads/items/${file.filename}`;
        }
        return file.path || file.url;
      });
      finalImages = [...finalImages, ...newUrls];
    }

    updateData.images = finalImages;

    // Eliminar de Cloudinary las fotos descartadas al actualizar
    if (imagesToDelete.length > 0) {
      deleteFromCloudinary(imagesToDelete).catch(err => console.warn('Error borrando fotos en Cloudinary:', err.message));
    }

    const updatedItem = await Item.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate('ownerId', 'name email phone location active');

    res.json(updatedItem);
  } catch (err) {
    console.error('Error en updateItem:', err);
    res.status(500).json({ msg: 'Error al actualizar la publicación.' });
  }
};

// Obtener un ítem por ID
const getItemById = async (req, res, next) => {
  try {
    const item = await Item.findById(req.params.id)
      .populate('ownerId', 'name email phone location active');
    if (!item) return res.status(404).json({ msg: 'Ítem no encontrado.' });

    // P-030: Si la cuenta del propietario fue suspendida y el solicitante no es staff
    if (item.ownerId && item.ownerId.active === false) {
      const isStaff = req.user && (['admin', 'gestor', 'dev'].includes(req.user.role) || req.user.isDev);
      if (!isStaff) {
        return res.status(404).json({
          msg: 'Esta publicación no está disponible porque la cuenta del ofertante ha sido suspendida.'
        });
      }
    }

    const itemObj = item.toObject();
    // 🔒 Proteger PII: Si el solicitante no está autenticado, no exponer teléfono ni email
    if (!req.user && itemObj.ownerId) {
      delete itemObj.ownerId.email;
      delete itemObj.ownerId.phone;
    } else if (req.user && itemObj.ownerId) {
      const isSelfOrStaff = req.user.id === itemObj.ownerId._id?.toString() ||
        ['admin', 'gestor', 'dev'].includes(req.user.role) || req.user.isDev;
      if (!isSelfOrStaff) {
        delete itemObj.ownerId.email;
      }
    }

    res.json(itemObj);
  } catch (err) {
    next(err);
  }
};

// Eliminar un ítem (dueño, gestor o admin)
const deleteItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ msg: 'Ítem no encontrado.' });

    const currentUserId = req.user?.id || req.user?._id;
    const isOwner = item.ownerId && currentUserId && item.ownerId.toString() === currentUserId.toString();
    const isAuthorizedStaff = ['admin', 'gestor'].includes(req.user?.role);

    if (!isOwner && !isAuthorizedStaff) {
      return res.status(403).json({ msg: 'No tienes permiso para eliminar este ítem.' });
    }

    // Eliminar de Cloudinary todas las imágenes asociadas al ítem
    if (item.images && item.images.length > 0) {
      deleteFromCloudinary(item.images).catch(err => console.warn('Error borrando fotos en Cloudinary:', err.message));
    }

    await Item.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Publicación eliminada correctamente.' });
  } catch (err) {
    res.status(500).json({ msg: 'Error al eliminar el ítem.' });
  }
};

const markAsBaled = async (req, res) => {
  try {
    // Verificar rol o cuenta dev
    if (req.user.role !== 'gestor' && req.user.role !== 'admin' && req.user.role !== 'dev' && !req.user.isDev) {
      return res.status(403).json({ msg: 'Solo los gestores y administradores pueden marcar materiales como fardados.' });
    }

    const { id } = req.params;

    // Actualización atómica en MongoDB para prevenir condiciones de carrera (TOCTOU)
    const item = await Item.findOneAndUpdate(
      { _id: id, processingState: { $in: ['sin_procesar', 'en_proceso'] } },
      { $set: { processingState: 'fardado' } },
      { new: true }
    );

    if (!item) {
      const existing = await Item.findById(id);
      if (!existing) return res.status(404).json({ msg: 'Ítem no encontrado.' });
      return res.status(400).json({ 
        msg: `El ítem ya está en estado "${existing.processingState}". Solo se puede fardar desde "sin_procesar" o "en_proceso".` 
      });
    }

    // Notificar al dueño de la publicación
    notificationService.notifyItemBaled({
      item,
      gestorId: req.user.id
    }).catch(err => console.error('Error al emitir notificación de fardado:', err));

    res.json({ 
      msg: 'Material marcado como fardado exitosamente.', 
      item: { _id: item._id, processingState: item.processingState } 
    });
  } catch (err) {
    console.error('Error en markAsBaled:', err);
    res.status(500).json({ msg: 'Error al marcar el material como fardado.' });
  }
};

module.exports = { createItem, searchItems, updateItem, getItemById, deleteItem, markAsBaled };