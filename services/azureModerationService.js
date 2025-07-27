const axios = require('axios');
const CircuitBreaker = require('opossum');
const { logger, logError, logModeration } = require('../utils/logger');
const config = require('../config/config');

class AzureModerationService {
  constructor() {
    this.config = config.azure;
    this.thresholds = config.moderation.thresholds;
    this.rules = config.moderation.rules;
    
    // Circuit breaker pour Azure
    this.circuitBreaker = new CircuitBreaker(this._callAzureAPI.bind(this), {
      timeout: config.circuitBreaker.azure.timeout,
      errorThresholdPercentage: config.circuitBreaker.azure.errorThresholdPercentage,
      resetTimeout: config.circuitBreaker.azure.resetTimeout
    });
    
    // Événements du circuit breaker
    this.circuitBreaker.on('open', () => {
      logger.warn('Azure circuit breaker opened - service temporarily unavailable');
    });
    
    this.circuitBreaker.on('close', () => {
      logger.info('Azure circuit breaker closed - service available again');
    });
    
    this.circuitBreaker.on('fallback', (result) => {
      logger.warn('Azure circuit breaker fallback triggered', { result });
    });
  }
  
  /**
   * Modère une image avec Azure Content Safety
   */
  async moderateImage(buffer, fileType = 'image/jpeg') {
    const startTime = Date.now();
    
    try {
      logger.info('Starting image moderation', { 
        fileType, 
        bufferSize: buffer.length 
      });
      
      const result = await this.circuitBreaker.fire(buffer);
      
      const processingTime = Date.now() - startTime;
      
      logModeration({
        verdict: result.verdict,
        ai_score: result.ai_score,
        categories: result.categories,
        fileType,
        fileSize: buffer.length,
        processingTime
      });
      
      return result;
      
    } catch (error) {
      logError(error, { 
        operation: 'moderateImage', 
        fileType, 
        bufferSize: buffer.length 
      });
      
      // Fallback en cas d'erreur
      return this._fallbackModeration(error);
    }
  }
  
  /**
   * Modère une vidéo en analysant ses thumbnails
   */
  async moderateVideo(thumbnails, fileType = 'video/mp4') {
    const startTime = Date.now();
    
    try {
      logger.info('Starting video moderation', { 
        fileType, 
        thumbnailCount: thumbnails.length 
      });
      
      const results = [];
      
      for (let i = 0; i < thumbnails.length; i++) {
        const thumbnail = thumbnails[i];
        logger.debug(`Moderating thumbnail ${i + 1}/${thumbnails.length}`);
        
        const result = await this.circuitBreaker.fire(thumbnail);
        results.push(result);
        
        // Si un thumbnail est rejeté, on peut arrêter
        if (result.verdict === 'rejected') {
          break;
        }
      }
      
      // Calcul du verdict global
      const globalResult = this._calculateVideoVerdict(results);
      
      const processingTime = Date.now() - startTime;
      
      logModeration({
        verdict: globalResult.verdict,
        ai_score: globalResult.ai_score,
        categories: globalResult.categories,
        fileType,
        fileSize: thumbnails.reduce((sum, t) => sum + t.length, 0),
        processingTime,
        thumbnailCount: thumbnails.length
      });
      
      return globalResult;
      
    } catch (error) {
      logError(error, { 
        operation: 'moderateVideo', 
        fileType, 
        thumbnailCount: thumbnails.length 
      });
      
      return this._fallbackModeration(error);
    }
  }
  
  /**
   * Appel direct à l'API Azure avec retry
   */
  async _callAzureAPI(buffer) {
    const base64Image = buffer.toString('base64');
    
    const response = await axios.post(
      `${this.config.endpoint}/contentsafety/image:analyze?api-version=${this.config.apiVersion}`,
      {
        image: {
          content: base64Image
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.config.key
        },
        timeout: config.timeouts.azureImage,
        validateStatus: (status) => status < 500
      }
    );
    
    if (response.status !== 200) {
      throw new Error(`Azure API error: ${response.status} - ${response.statusText}`);
    }
    
    const result = response.data;
    const categories = result.categoriesAnalysis || [];
    
    // Application des règles de modération
    const moderationResult = this._applyModerationRules(categories);
    
    return {
      verdict: moderationResult.rejected ? 'rejected' : 'accepted',
      categories,
      rejectionReason: moderationResult.reason,
      ai_score: this._calculateAIScore(categories)
    };
  }
  
  /**
   * Applique les règles de modération strictes
   */
  _applyModerationRules(categories) {
    const { weaponScore, violenceScore } = this._detectWeaponsAndViolence(categories);
    
    // Règles de rejet
    const rules = [
      // 🚨 ENFANTS : Zéro tolérance absolue
      {
        condition: () => categories.some(c => c.category === "Child" && c.severity >= this.thresholds.child),
        reason: "🚨 ENFANT DÉTECTÉ - INTERDIT ABSOLU sur plateforme adulte"
      },
      
      // 🔫 VIOLENCE : Seuil très bas
      {
        condition: () => violenceScore >= this.thresholds.violence,
        reason: `🔫 Violence détectée (score: ${violenceScore}) - Seuil très bas pour plateforme adulte`
      },
      
      // 🚫 ARMES/SYMBOLES VIOLENTS : Seuil très bas
      {
        condition: () => weaponScore >= this.thresholds.weapons,
        reason: `🚫 Arme/symbole violent détecté (score: ${weaponScore}) - Interdit`
      },
      
      // 🚫 HATE : Seuil très bas
      {
        condition: () => categories.some(c => c.category === "Hate" && c.severity >= this.thresholds.hate),
        reason: "🚫 Contenu haineux détecté - Interdit"
      },
      
      // 🚫 SUICIDE/AUTOMUTILATION : Seuil très bas
      {
        condition: () => categories.some(c => c.category === "SelfHarm" && c.severity >= this.thresholds.selfHarm),
        reason: "🚫 Contenu d'automutilation/suicide détecté - Interdit"
      },
      
      // 🔞 CONTENU SEXUEL : Plus strict
      {
        condition: () => categories.some(c => c.category === "Sexual" && c.severity >= this.thresholds.sexual),
        reason: "🔞 Contenu sexuel trop explicite - Interdit"
      }
    ];
    
    // Règles spéciales combinées
    if (this.rules.childWithViolence) {
      rules.push({
        condition: () => categories.some(c => c.category === "Child" && c.severity >= this.thresholds.child) && 
                     (violenceScore >= this.thresholds.violence || weaponScore >= this.thresholds.weapons),
        reason: "🚨 Enfant avec violence/armes - REJET IMMÉDIAT"
      });
    }
    
    if (this.rules.childWithHate) {
      rules.push({
        condition: () => categories.some(c => c.category === "Child" && c.severity >= this.thresholds.child) && 
                     categories.some(c => c.category === "Hate" && c.severity >= this.thresholds.hate),
        reason: "🚨 Enfant avec contenu haineux - REJET IMMÉDIAT"
      });
    }
    
    if (this.rules.sexualWithChild) {
      rules.push({
        condition: () => categories.some(c => c.category === "Sexual" && c.severity >= 2) && 
                     categories.some(c => c.category === "Child" && c.severity >= this.thresholds.child),
        reason: "🚨 Contenu sexuel avec enfant - REJET IMMÉDIAT"
      });
    }
    
    // Vérification des règles
    for (const rule of rules) {
      if (rule.condition()) {
        return { rejected: true, reason: rule.reason };
      }
    }
    
    return { rejected: false, reason: null };
  }
  
  /**
   * Détection renforcée d'armes et violence
   */
  _detectWeaponsAndViolence(categories) {
    let weaponScore = 0;
    let violenceScore = 0;
    
    for (const cat of categories) {
      // 🔫 Violence directe
      if (cat.category === "Violence") {
        violenceScore = Math.max(violenceScore, cat.severity || 0);
      }
      
      // 🚫 Hate peut inclure des symboles violents/armes
      if (cat.category === "Hate" && cat.severity >= 1) {
        weaponScore = Math.max(weaponScore, cat.severity || 0);
      }
      
      // 🔫 SelfHarm peut inclure des armes
      if (cat.category === "SelfHarm" && cat.severity >= 1) {
        weaponScore = Math.max(weaponScore, cat.severity || 0);
      }
      
      // 🔫 Sexual avec violence
      if (cat.category === "Sexual" && cat.severity >= 3) {
        violenceScore = Math.max(violenceScore, 1);
      }
    }
    
    // 🚨 Bonus de sévérité pour être plus strict
    if (violenceScore > 0) violenceScore += this.rules.violenceBonus;
    if (weaponScore > 0) weaponScore += this.rules.weaponBonus;
    
    return { weaponScore, violenceScore };
  }
  
  /**
   * Calcul du score IA moyen
   */
  _calculateAIScore(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return 0;
    const sum = categories.reduce((acc, c) => acc + (typeof c.severity === 'number' ? c.severity : 0), 0);
    const mean = sum / categories.length;
    return typeof mean === 'number' && !isNaN(mean) ? mean : 0;
  }
  
  /**
   * Calcul du verdict global pour une vidéo
   */
  _calculateVideoVerdict(results) {
    const allCategories = results.flatMap(r => r.categories || []);
    const allAccepted = results.every(r => r.verdict === 'accepted');
    const anyRejected = results.some(r => r.verdict === 'rejected');
    
    if (anyRejected) {
      const rejectedResult = results.find(r => r.verdict === 'rejected');
      return {
        verdict: 'rejected',
        rejectionReason: rejectedResult.rejectionReason || 'Contenu inapproprié détecté dans les frames vidéo',
        categories: allCategories,
        ai_score: this._calculateAIScore(allCategories)
      };
    }
    
    return {
      verdict: 'accepted',
      categories: allCategories,
      ai_score: this._calculateAIScore(allCategories)
    };
  }
  
  /**
   * Fallback en cas d'erreur Azure
   */
  _fallbackModeration(error) {
    logger.warn('Using fallback moderation due to Azure error', { 
      error: error.message 
    });
    
    // En cas d'erreur, on rejette par sécurité
    return {
      verdict: 'rejected',
      rejectionReason: 'Service de modération temporairement indisponible - Rejet par sécurité',
      categories: [],
      ai_score: 0
    };
  }
  
  /**
   * Test des règles de modération
   */
  testModerationRules(testCategories) {
    const mockCategories = testCategories.map(cat => ({
      category: cat.category,
      severity: cat.severity || 0
    }));
    
    const { weaponScore, violenceScore } = this._detectWeaponsAndViolence(mockCategories);
    const moderationResult = this._applyModerationRules(mockCategories);
    const ai_score = this._calculateAIScore(mockCategories);
    
    return {
      testCategories: mockCategories,
      weaponScore,
      violenceScore,
      ai_score,
      verdict: moderationResult.rejected ? 'rejected' : 'accepted',
      rejectionReason: moderationResult.reason
    };
  }
}

module.exports = AzureModerationService; 