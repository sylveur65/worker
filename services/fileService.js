const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fileType = require('file-type');
const { logger, logError } = require('../utils/logger');
const config = require('../config/config');

class FileService {
  constructor() {
    this.config = config.upload;
    this.tempDir = this.config.tempDir;
    
    // Créer le dossier temp s'il n'existe pas
    this._ensureTempDir();
  }
  
  /**
   * Valider un fichier (type, taille)
   */
  validateFile(buffer, originalName) {
    const fileInfo = fileType.fromBuffer(buffer);
    const fileSize = buffer.length;
    
    // Vérification de la taille
    if (fileSize > this.config.maxFileSize) {
      throw new Error(`File too large: ${(fileSize / 1024 / 1024).toFixed(2)}MB (max: ${(this.config.maxFileSize / 1024 / 1024).toFixed(2)}MB)`);
    }
    
    // Vérification du type
    if (!fileInfo) {
      throw new Error('Unable to determine file type');
    }
    
    const mimeType = fileInfo.mime;
    const isImage = this.config.allowedImageTypes.includes(mimeType);
    const isVideo = this.config.allowedVideoTypes.includes(mimeType);
    
    if (!isImage && !isVideo) {
      throw new Error(`File type not allowed: ${mimeType}`);
    }
    
    return {
      mimeType,
      isImage,
      isVideo,
      size: fileSize,
      extension: fileInfo.ext
    };
  }
  
  /**
   * Générer un thumbnail pour une image
   */
  async generateImageThumbnail(buffer, width = null) {
    try {
      const targetWidth = width || this.config.thumbnailSize;
      
      logger.info('Generating image thumbnail', { 
        originalSize: buffer.length, 
        targetWidth 
      });
      
      const thumbnailBuffer = await sharp(buffer)
        .resize(targetWidth, null, { withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      logger.info('Image thumbnail generated', { 
        originalSize: buffer.length, 
        thumbnailSize: thumbnailBuffer.length 
      });
      
      return thumbnailBuffer;
      
    } catch (error) {
      logError(error, { 
        operation: 'generateImageThumbnail', 
        originalSize: buffer.length 
      });
      
      throw new Error(`Failed to generate image thumbnail: ${error.message}`);
    }
  }
  
  /**
   * Générer des thumbnails pour une vidéo
   */
  async generateVideoThumbnails(videoPath, count = 3) {
    try {
      logger.info('Generating video thumbnails', { 
        videoPath, 
        count 
      });
      
      // Obtenir la durée de la vidéo
      const duration = await this._getVideoDuration(videoPath);
      
      // Calculer les timestamps
      const timestamps = this._calculateTimestamps(duration, count);
      
      // Générer les thumbnails
      const thumbnails = [];
      
      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        const thumbnailPath = path.join(this.tempDir, `thumb-${uuidv4()}-${i}.jpg`);
        
        await this._extractVideoFrame(videoPath, thumbnailPath, timestamp);
        
        const thumbnailBuffer = await fs.readFile(thumbnailPath);
        thumbnails.push(thumbnailBuffer);
        
        // Nettoyer le fichier temporaire
        await fs.unlink(thumbnailPath);
      }
      
      logger.info('Video thumbnails generated', { 
        videoPath, 
        count: thumbnails.length,
        timestamps 
      });
      
      return thumbnails;
      
    } catch (error) {
      logError(error, { 
        operation: 'generateVideoThumbnails', 
        videoPath, 
        count 
      });
      
      throw new Error(`Failed to generate video thumbnails: ${error.message}`);
    }
  }
  
  /**
   * Sauvegarder un fichier temporaire
   */
  async saveTempFile(buffer, filename) {
    try {
      const tempPath = path.join(this.tempDir, filename);
      await fs.writeFile(tempPath, buffer);
      
      logger.info('Temp file saved', { 
        path: tempPath, 
        size: buffer.length 
      });
      
      return tempPath;
      
    } catch (error) {
      logError(error, { 
        operation: 'saveTempFile', 
        filename, 
        size: buffer.length 
      });
      
      throw new Error(`Failed to save temp file: ${error.message}`);
    }
  }
  
  /**
   * Supprimer un fichier temporaire
   */
  async deleteTempFile(filePath) {
    try {
      await fs.unlink(filePath);
      
      logger.debug('Temp file deleted', { path: filePath });
      
    } catch (error) {
      // On ne fait pas échouer si le fichier n'existe pas
      if (error.code !== 'ENOENT') {
        logError(error, { 
          operation: 'deleteTempFile', 
          path: filePath 
        });
      }
    }
  }
  
  /**
   * Nettoyer tous les fichiers temporaires
   */
  async cleanupTempFiles() {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = config.cleanup.tempFiles.maxAge;
      
      let deletedCount = 0;
      let errorCount = 0;
      
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtime.getTime();
          
          if (age > maxAge) {
            await fs.unlink(filePath);
            deletedCount++;
            logger.debug('Cleaned up old temp file', { file, age: Math.round(age / 1000 / 60) + 'min' });
          }
          
        } catch (error) {
          errorCount++;
          logger.warn('Failed to cleanup temp file', { file, error: error.message });
        }
      }
      
      logger.info('Temp files cleanup completed', { 
        total: files.length, 
        deleted: deletedCount, 
        errors: errorCount 
      });
      
      return { total: files.length, deleted: deletedCount, errors: errorCount };
      
    } catch (error) {
      logError(error, { operation: 'cleanupTempFiles' });
      throw new Error(`Failed to cleanup temp files: ${error.message}`);
    }
  }
  
  /**
   * Obtenir la durée d'une vidéo
   */
  async _getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to get video duration: ${err.message}`));
          return;
        }
        
        resolve(metadata.format.duration);
      });
    });
  }
  
  /**
   * Calculer les timestamps pour les thumbnails
   */
  _calculateTimestamps(duration, count) {
    const timestamps = [];
    const interval = Math.max(5, duration / (count + 1));
    
    for (let i = 1; i <= count; i++) {
      const timestamp = Math.min(duration - 5, i * interval);
      timestamps.push(timestamp.toString());
    }
    
    // Fallback si vidéo très courte
    if (timestamps.length === 0) {
      timestamps.push('5');
    }
    
    return timestamps;
  }
  
  /**
   * Extraire une frame d'une vidéo
   */
  async _extractVideoFrame(videoPath, outputPath, timestamp) {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timestamp],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: `${this.config.thumbnailSize}x?`
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`Failed to extract frame: ${err.message}`)));
    });
  }
  
  /**
   * S'assurer que le dossier temp existe
   */
  async _ensureTempDir() {
    try {
      await fs.access(this.tempDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(this.tempDir, { recursive: true });
        logger.info('Created temp directory', { path: this.tempDir });
      }
    }
  }
  
  /**
   * Obtenir les métriques du service
   */
  async getMetrics() {
    try {
      const files = await fs.readdir(this.tempDir);
      const stats = await fs.stat(this.tempDir);
      
      return {
        tempDir: this.tempDir,
        fileCount: files.length,
        lastModified: stats.mtime,
        maxFileSize: this.config.maxFileSize,
        allowedImageTypes: this.config.allowedImageTypes,
        allowedVideoTypes: this.config.allowedVideoTypes
      };
      
    } catch (error) {
      logError(error, { operation: 'getMetrics' });
      return { error: error.message };
    }
  }
}

module.exports = FileService; 