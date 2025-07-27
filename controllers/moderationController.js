const { v4: uuidv4 } = require('uuid');
const { logger, logError } = require('../utils/logger');
const { ValidationError, FileTooLargeError, InvalidFileTypeError } = require('../middlewares/errorHandler');
const AzureModerationService = require('../services/azureModerationService');
const StorageService = require('../services/storageService');
const FileService = require('../services/fileService');
const config = require('../config/config');

class ModerationController {
  constructor() {
    this.azureService = new AzureModerationService();
    this.storageService = new StorageService();
    this.fileService = new FileService();
  }
  
  /**
   * Modérer une image uploadée directement
   */
  async moderateImage(req, res) {
    const startTime = Date.now();
    
    try {
      const { file } = req;
      const { creatorId } = req.body;
      
      if (!file) {
        throw new ValidationError('No image file provided');
      }
      
      if (!creatorId) {
        throw new ValidationError('Creator ID is required');
      }
      
      logger.info('Starting image moderation', { 
        filename: file.originalname, 
        size: file.size,
        creatorId 
      });
      
      // Validation du fichier
      const fileInfo = this.fileService.validateFile(file.buffer, file.originalname);
      
      if (!fileInfo.isImage) {
        throw new InvalidFileTypeError(`File type not allowed: ${fileInfo.mimeType}`);
      }
      
      // Modération avec Azure
      const moderationResult = await this.azureService.moderateImage(file.buffer, fileInfo.mimeType);
      
      if (moderationResult.verdict === 'rejected') {
        logger.warn('Image rejected by moderation', {
          filename: file.originalname,
          reason: moderationResult.rejectionReason,
          ai_score: moderationResult.ai_score
        });
        
        return res.json({
          success: false,
          verdict: 'rejected',
          rejectionReason: moderationResult.rejectionReason,
          ai_score: moderationResult.ai_score,
          categories: moderationResult.categories,
          processingTime: Date.now() - startTime
        });
      }
      
      // Génération du thumbnail
      const thumbnailBuffer = await this.fileService.generateImageThumbnail(file.buffer);
      
      // Upload sur R2
      const uuid = uuidv4();
      const imageKey = `media/${creatorId}/${uuid}-${file.originalname}`;
      const thumbKey = `media/${creatorId}/thumb-${uuid}.jpg`;
      
      await Promise.all([
        this.storageService.uploadFile(file.buffer, imageKey, fileInfo.mimeType),
        this.storageService.uploadFile(thumbnailBuffer, thumbKey, 'image/jpeg')
      ]);
      
      const processingTime = Date.now() - startTime;
      
      logger.info('Image moderation completed successfully', {
        filename: file.originalname,
        imageKey,
        thumbKey,
        processingTime
      });
      
      res.json({
        success: true,
        verdict: 'accepted',
        imageR2Key: imageKey,
        thumbR2Key: thumbKey,
        ai_score: moderationResult.ai_score,
        processingTime
      });
      
    } catch (error) {
      logError(error, { 
        operation: 'moderateImage', 
        filename: req.file?.originalname 
      });
      
      throw error;
    }
  }
  
  /**
   * Modérer une vidéo uploadée directement
   */
  async moderateVideo(req, res) {
    const startTime = Date.now();
    
    try {
      const { file } = req;
      const { creatorId } = req.body;
      
      if (!file) {
        throw new ValidationError('No video file provided');
      }
      
      if (!creatorId) {
        throw new ValidationError('Creator ID is required');
      }
      
      logger.info('Starting video moderation', { 
        filename: file.originalname, 
        size: file.size,
        creatorId 
      });
      
      // Validation du fichier
      const fileInfo = this.fileService.validateFile(file.buffer, file.originalname);
      
      if (!fileInfo.isVideo) {
        throw new InvalidFileTypeError(`File type not allowed: ${fileInfo.mimeType}`);
      }
      
      // Sauvegarder temporairement la vidéo
      const tempVideoPath = await this.fileService.saveTempFile(file.buffer, `${uuidv4()}-${file.originalname}`);
      
      try {
        // Générer les thumbnails
        const thumbnails = await this.fileService.generateVideoThumbnails(tempVideoPath, 3);
        
        // Modérer chaque thumbnail
        const moderationResult = await this.azureService.moderateVideo(thumbnails, fileInfo.mimeType);
        
        if (moderationResult.verdict === 'rejected') {
          logger.warn('Video rejected by moderation', {
            filename: file.originalname,
            reason: moderationResult.rejectionReason,
            ai_score: moderationResult.ai_score
          });
          
          return res.json({
            success: false,
            verdict: 'rejected',
            rejectionReason: moderationResult.rejectionReason,
            ai_score: moderationResult.ai_score,
            categories: moderationResult.categories,
            processingTime: Date.now() - startTime
          });
        }
        
        // Upload de la vidéo sur R2
        const uuid = uuidv4();
        const videoKey = `media/${creatorId}/${uuid}-${file.originalname}`;
        
        await this.storageService.uploadFile(file.buffer, videoKey, fileInfo.mimeType);
        
        const processingTime = Date.now() - startTime;
        
        logger.info('Video moderation completed successfully', {
          filename: file.originalname,
          videoKey,
          processingTime
        });
        
        res.json({
          success: true,
          verdict: 'accepted',
          videoR2Key: videoKey,
          ai_score: moderationResult.ai_score,
          processingTime
        });
        
      } finally {
        // Nettoyer le fichier temporaire
        await this.fileService.deleteTempFile(tempVideoPath);
      }
      
    } catch (error) {
      logError(error, { 
        operation: 'moderateVideo', 
        filename: req.file?.originalname 
      });
      
      throw error;
    }
  }
  
  /**
   * Modérer une image depuis R2
   */
  async moderateImageFromR2(req, res) {
    const startTime = Date.now();
    
    try {
      const { r2Key, creatorId, type } = req.body;
      
      if (!r2Key || !type) {
        throw new ValidationError('Missing r2Key or type');
      }
      
      logger.info('Starting R2 image moderation', { r2Key, type, creatorId });
      
      // Télécharger l'image depuis R2
      const imageBuffer = await this.storageService.downloadFile(r2Key);
      
      // Validation du fichier
      const fileInfo = this.fileService.validateFile(imageBuffer, r2Key);
      
      if (!fileInfo.isImage) {
        throw new InvalidFileTypeError(`File type not allowed: ${fileInfo.mimeType}`);
      }
      
      // Modération avec Azure
      const moderationResult = await this.azureService.moderateImage(imageBuffer, fileInfo.mimeType);
      
      if (moderationResult.verdict === 'rejected') {
        logger.warn('R2 image rejected by moderation', {
          r2Key,
          reason: moderationResult.rejectionReason,
          ai_score: moderationResult.ai_score
        });
        
        // Supprimer le fichier rejeté de R2
        await this.storageService.deleteFile(r2Key);
        
        return res.json({
          success: false,
          verdict: 'rejected',
          rejectionReason: moderationResult.rejectionReason,
          ai_score: moderationResult.ai_score,
          categories: moderationResult.categories,
          processingTime: Date.now() - startTime
        });
      }
      
      // Génération du thumbnail
      const thumbnailBuffer = await this.fileService.generateImageThumbnail(imageBuffer);
      
      // Upload des fichiers traités sur R2
      const uuid = uuidv4();
      const processedImageKey = `media/${uuid}-processed.jpg`;
      const thumbKey = `media/thumb-${uuid}.jpg`;
      
      await Promise.all([
        this.storageService.uploadFile(imageBuffer, processedImageKey, fileInfo.mimeType),
        this.storageService.uploadFile(thumbnailBuffer, thumbKey, 'image/jpeg')
      ]);
      
      // Supprimer le fichier original
      await this.storageService.deleteFile(r2Key);
      
      const processingTime = Date.now() - startTime;
      
      logger.info('R2 image moderation completed successfully', {
        originalKey: r2Key,
        processedKey: processedImageKey,
        thumbKey,
        processingTime
      });
      
      res.json({
        success: true,
        verdict: 'accepted',
        imageR2Key: processedImageKey,
        thumbR2Key: thumbKey,
        ai_score: moderationResult.ai_score,
        processingTime
      });
      
    } catch (error) {
      logError(error, { 
        operation: 'moderateImageFromR2', 
        r2Key: req.body?.r2Key 
      });
      
      throw error;
    }
  }
  
  /**
   * Modérer une vidéo depuis R2
   */
  async moderateVideoFromR2(req, res) {
    const startTime = Date.now();
    
    try {
      const { r2Key, creatorId, type } = req.body;
      
      if (!r2Key || !creatorId) {
        throw new ValidationError('Missing r2Key or creatorId');
      }
      
      logger.info('Starting R2 video moderation', { r2Key, type, creatorId });
      
      // Télécharger la vidéo depuis R2
      const videoBuffer = await this.storageService.downloadFile(r2Key);
      
      // Validation du fichier
      const fileInfo = this.fileService.validateFile(videoBuffer, r2Key);
      
      if (!fileInfo.isVideo) {
        throw new InvalidFileTypeError(`File type not allowed: ${fileInfo.mimeType}`);
      }
      
      // Sauvegarder temporairement la vidéo
      const tempVideoPath = await this.fileService.saveTempFile(videoBuffer, `${uuidv4()}-video.mp4`);
      
      try {
        // Générer les thumbnails
        const thumbnails = await this.fileService.generateVideoThumbnails(tempVideoPath, 3);
        
        // Modérer chaque thumbnail
        const moderationResult = await this.azureService.moderateVideo(thumbnails, fileInfo.mimeType);
        
        if (moderationResult.verdict === 'rejected') {
          logger.warn('R2 video rejected by moderation', {
            r2Key,
            reason: moderationResult.rejectionReason,
            ai_score: moderationResult.ai_score
          });
          
          // Supprimer le fichier rejeté de R2
          await this.storageService.deleteFile(r2Key);
          
          return res.json({
            success: false,
            verdict: 'rejected',
            rejectionReason: moderationResult.rejectionReason,
            ai_score: moderationResult.ai_score,
            categories: moderationResult.categories,
            processingTime: Date.now() - startTime
          });
        }
        
        // Upload des thumbnails sur R2
        const thumbKeys = [];
        for (const thumbnail of thumbnails) {
          const thumbKey = `media/thumb-${uuidv4()}.jpg`;
          await this.storageService.uploadFile(thumbnail, thumbKey, 'image/jpeg');
          thumbKeys.push(thumbKey);
        }
        
        const processingTime = Date.now() - startTime;
        
        logger.info('R2 video moderation completed successfully', {
          r2Key,
          thumbKeys,
          processingTime
        });
        
        res.json({
          success: true,
          verdict: 'accepted',
          ai_score: moderationResult.ai_score,
          thumbR2Keys: thumbKeys,
          processingTime
        });
        
      } finally {
        // Nettoyer le fichier temporaire
        await this.fileService.deleteTempFile(tempVideoPath);
      }
      
    } catch (error) {
      logError(error, { 
        operation: 'moderateVideoFromR2', 
        r2Key: req.body?.r2Key 
      });
      
      throw error;
    }
  }
  
  /**
   * Générer une presigned URL d'upload
   */
  async generateUploadUrl(req, res) {
    try {
      const { key, contentType } = req.body;
      
      if (!key || !contentType) {
        throw new ValidationError('Missing key or contentType');
      }
      
      const result = await this.storageService.generateUploadUrl(key, contentType);
      
      res.json({
        success: true,
        url: result.url
      });
      
    } catch (error) {
      logError(error, { operation: 'generateUploadUrl' });
      throw error;
    }
  }
  
  /**
   * Générer une presigned URL de lecture
   */
  async generateReadUrl(req, res) {
    try {
      const { key } = req.body;
      
      if (!key) {
        throw new ValidationError('Missing key');
      }
      
      const result = await this.storageService.generateReadUrl(key);
      
      res.json({
        success: true,
        url: result.url
      });
      
    } catch (error) {
      logError(error, { operation: 'generateReadUrl' });
      throw error;
    }
  }
  
  /**
   * Tester les règles de modération
   */
  async testModerationRules(req, res) {
    try {
      const { testCategories } = req.body;
      
      if (!Array.isArray(testCategories)) {
        throw new ValidationError('testCategories must be an array');
      }
      
      const result = this.azureService.testModerationRules(testCategories);
      
      res.json({
        success: true,
        result
      });
      
    } catch (error) {
      logError(error, { operation: 'testModerationRules' });
      throw error;
    }
  }
  
  /**
   * Obtenir les métriques des services
   */
  async getMetrics(req, res) {
    try {
      const [storageMetrics, fileMetrics] = await Promise.all([
        this.storageService.getMetrics(),
        this.fileService.getMetrics()
      ]);
      
      res.json({
        success: true,
        metrics: {
          storage: storageMetrics,
          file: fileMetrics,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      logError(error, { operation: 'getMetrics' });
      throw error;
    }
  }
}

module.exports = ModerationController; 