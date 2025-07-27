const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const CircuitBreaker = require('opossum');
const { logger, logError, logStorage } = require('../utils/logger');
const config = require('../config/config');

class StorageService {
  constructor() {
    this.config = config.r2;
    
    // Client S3 pour R2
    this.s3Client = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
    
    // Circuit breaker pour R2
    this.circuitBreaker = new CircuitBreaker(this._callR2API.bind(this), {
      timeout: config.circuitBreaker.r2.timeout,
      errorThresholdPercentage: config.circuitBreaker.r2.errorThresholdPercentage,
      resetTimeout: config.circuitBreaker.r2.resetTimeout
    });
    
    // Événements du circuit breaker
    this.circuitBreaker.on('open', () => {
      logger.warn('R2 circuit breaker opened - storage temporarily unavailable');
    });
    
    this.circuitBreaker.on('close', () => {
      logger.info('R2 circuit breaker closed - storage available again');
    });
    
    this.circuitBreaker.on('fallback', (result) => {
      logger.warn('R2 circuit breaker fallback triggered', { result });
    });
  }
  
  /**
   * Upload un fichier sur R2
   */
  async uploadFile(buffer, key, contentType) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting file upload to R2', { 
        key, 
        contentType, 
        size: buffer.length 
      });
      
      const result = await this.circuitBreaker.fire({
        operation: 'upload',
        buffer,
        key,
        contentType
      });
      
      const duration = Date.now() - startTime;
      
      logStorage('upload', {
        key,
        size: buffer.length,
        type: contentType,
        duration
      });
      
      return result;
      
    } catch (error) {
      logError(error, { 
        operation: 'uploadFile', 
        key, 
        contentType, 
        size: buffer.length 
      });
      
      throw new Error(`Upload failed: ${error.message}`);
    }
  }
  
  /**
   * Télécharger un fichier depuis R2
   */
  async downloadFile(key) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting file download from R2', { key });
      
      const result = await this.circuitBreaker.fire({
        operation: 'download',
        key
      });
      
      const duration = Date.now() - startTime;
      
      logStorage('download', {
        key,
        size: result.length,
        type: 'unknown',
        duration
      });
      
      return result;
      
    } catch (error) {
      logError(error, { 
        operation: 'downloadFile', 
        key 
      });
      
      if (error.name === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      
      throw new Error(`Download failed: ${error.message}`);
    }
  }
  
  /**
   * Supprimer un fichier de R2
   */
  async deleteFile(key) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting file deletion from R2', { key });
      
      const result = await this.circuitBreaker.fire({
        operation: 'delete',
        key
      });
      
      const duration = Date.now() - startTime;
      
      logStorage('delete', {
        key,
        size: 0,
        type: 'unknown',
        duration
      });
      
      return result;
      
    } catch (error) {
      logError(error, { 
        operation: 'deleteFile', 
        key 
      });
      
      // On ne fait pas échouer la suppression
      logger.warn('File deletion failed, but continuing', { key, error: error.message });
      return false;
    }
  }
  
  /**
   * Générer une presigned URL d'upload
   */
  async generateUploadUrl(key, contentType, expiresIn = 600) {
    try {
      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        ContentType: contentType
      });
      
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      
      logger.info('Generated upload presigned URL', { 
        key, 
        contentType, 
        expiresIn 
      });
      
      return { url };
      
    } catch (error) {
      logError(error, { 
        operation: 'generateUploadUrl', 
        key, 
        contentType 
      });
      
      throw new Error(`Failed to generate upload URL: ${error.message}`);
    }
  }
  
  /**
   * Générer une presigned URL de lecture
   */
  async generateReadUrl(key, expiresIn = 600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key
      });
      
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      
      logger.info('Generated read presigned URL', { 
        key, 
        expiresIn 
      });
      
      return { url };
      
    } catch (error) {
      logError(error, { 
        operation: 'generateReadUrl', 
        key 
      });
      
      throw new Error(`Failed to generate read URL: ${error.message}`);
    }
  }
  
  /**
   * Vérifier si un fichier existe
   */
  async fileExists(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key
      });
      
      await this.s3Client.send(command);
      return true;
      
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        return false;
      }
      
      logError(error, { 
        operation: 'fileExists', 
        key 
      });
      
      throw new Error(`Failed to check file existence: ${error.message}`);
    }
  }
  
  /**
   * Appel direct à l'API R2 avec gestion d'erreurs
   */
  async _callR2API(params) {
    const { operation, buffer, key, contentType } = params;
    
    try {
      switch (operation) {
        case 'upload':
          const uploadCommand = new PutObjectCommand({
            Bucket: this.config.bucketName,
            Key: key,
            Body: buffer,
            ContentType: contentType,
          });
          
          await this.s3Client.send(uploadCommand);
          return { success: true, key };
          
        case 'download':
          const downloadCommand = new GetObjectCommand({
            Bucket: this.config.bucketName,
            Key: key
          });
          
          const response = await this.s3Client.send(downloadCommand);
          const chunks = [];
          
          for await (const chunk of response.Body) {
            chunks.push(chunk);
          }
          
          return Buffer.concat(chunks);
          
        case 'delete':
          const deleteCommand = new DeleteObjectCommand({
            Bucket: this.config.bucketName,
            Key: key
          });
          
          await this.s3Client.send(deleteCommand);
          return { success: true };
          
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
      
    } catch (error) {
      // Gestion spécifique des erreurs R2
      if (error.name === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      
      if (error.name === 'AccessDenied') {
        throw new Error(`Access denied to file: ${key}`);
      }
      
      if (error.name === 'InvalidAccessKeyId' || error.name === 'SignatureDoesNotMatch') {
        throw new Error('Invalid R2 credentials');
      }
      
      if (error.name === 'NetworkingError' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        throw new Error('Network error connecting to R2');
      }
      
      throw error;
    }
  }
  
  /**
   * Nettoyer les fichiers temporaires
   */
  async cleanupTempFiles(keys) {
    const results = [];
    
    for (const key of keys) {
      try {
        await this.deleteFile(key);
        results.push({ key, success: true });
      } catch (error) {
        results.push({ key, success: false, error: error.message });
      }
    }
    
    logger.info('Cleanup completed', { 
      total: keys.length, 
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
    
    return results;
  }
  
  /**
   * Obtenir les métriques de stockage
   */
  getMetrics() {
    return {
      circuitBreaker: {
        state: this.circuitBreaker.opened ? 'open' : 'closed',
        stats: this.circuitBreaker.stats
      },
      bucket: this.config.bucketName,
      endpoint: this.config.endpoint
    };
  }
}

module.exports = StorageService; 