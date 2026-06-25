// ==================== Google Places Adapter (New API v1) ====================
// Google Maps Places API (New) + Geocoding API 适配器，用于发现目标公司
//
// 使用新版 Places API v1:
// - SearchText: POST https://places.googleapis.com/v1/places:searchText
// - Place Details: GET https://places.googleapis.com/v1/places/{place_id}
// - Geocoding: GET https://maps.googleapis.com/maps/api/geocode/json

import type { 
  RadarAdapter, 
  RadarSearchQuery, 
  RadarSearchResult, 
  NormalizedCandidate,
  HealthStatus,
  AdapterFeatures,
  AdapterConfig,
} from './types';
import { getCountryDisplayName } from '../country-utils';

// ==================== Places API (New) 类型 ====================

interface PlacesApiText {
  text: string;
  languageCode?: string;
}

interface PlacesApiLocation {
  latitude: number;
  longitude: number;
}

interface PlaceResultNew {
  id: string;
  displayName?: PlacesApiText;
  formattedAddress?: string;
  location?: PlacesApiLocation;
  types?: string[];
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  editorialSummary?: PlacesApiText;
}

interface SearchTextRequest {
  textQuery: string;
  languageCode?: string;
  regionCode?: string;
  locationBias?: {
    circle: {
      center: { latitude: number; longitude: number };
      radius: number;
    };
  };
  includedType?: string;
  pageSize?: number;
  pageToken?: string;
}

interface SearchTextResponse {
  places?: PlaceResultNew[];
  nextPageToken?: string;
}

// Geocoding API 类型
interface GeocodingResult {
  place_id: string;
  formatted_address: string;
  geometry: {
    location: { lat: number; lng: number };
  };
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

interface GeocodingResponse {
  results: GeocodingResult[];
  status: string;
  error_message?: string;
}

export interface GeocodingResultParsed {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
}

// ==================== Places API (New) 字段掩码 ====================

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.businessStatus',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.googleMapsUri',
  'places.editorialSummary',
  'places.currentOpeningHours',
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'businessStatus',
  'rating',
  'userRatingCount',
  'websiteUri',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'googleMapsUri',
  'editorialSummary',
  'currentOpeningHours',
].join(',');

// ==================== Google Places 适配器 (New API v1) ====================

export class GooglePlacesAdapter implements RadarAdapter {
  readonly sourceCode = 'google_places';
  readonly channelType = 'MAPS' as const;
  
  readonly supportedFeatures: AdapterFeatures = {
    supportsKeywordSearch: true,
    supportsCategoryFilter: true,
    supportsDateFilter: false,
    supportsRegionFilter: true,
    supportsPagination: true,
    supportsDetails: true,
    maxResultsPerQuery: 60,
    rateLimit: { requests: 100, windowMs: 60000 },
  };

  private apiKey: string;
  private timeout: number;

  constructor(config: AdapterConfig) {
    this.apiKey = config.apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
    this.timeout = config.timeout || 30000;
  }

  // ==================== 主搜索接口 ====================

  async search(query: RadarSearchQuery): Promise<RadarSearchResult> {
    const startTime = Date.now();
    
    if (!this.apiKey) {
      throw new Error('Google Maps API key not configured');
    }
    
    // 构建搜索查询
    const searchText = this.buildSearchText(query);
    
    // 执行 Text Search (New API v1)
    const results = await this.textSearchNew(searchText, query);
    
    // 结果已包含详细信息，无需额外 hydrate
    // 标准化结果
    const items = results.map(r => this.normalizeNew(r));
    
    const duration = Date.now() - startTime;
    
    return {
      items,
      total: items.length,
      hasMore: false,
      metadata: {
        source: this.sourceCode,
        query,
        fetchedAt: new Date(),
        duration,
      },
      isExhausted: true,
    };
  }

  // ==================== 搜索文本构建 ====================

  /**
   * 构建搜索文本
   */
  private buildSearchText(query: RadarSearchQuery): string {
    const parts: string[] = [];
    
    // 关键词 - 只取前3个，避免查询过长
    if (query.keywords?.length) {
      const topKeywords = query.keywords.slice(0, 3);
      parts.push(topKeywords.join(' '));
    }
    
    // 行业/类型
    if (query.targetIndustries?.length) {
      parts.push(query.targetIndustries[0]);
    }
    
    // 公司类型
    if (query.companyTypes?.length) {
      const typeMap: Record<string, string> = {
        manufacturer: 'manufacturer factory',
        distributor: 'distributor supplier',
        service_provider: 'service company',
      };
      parts.push(typeMap[query.companyTypes[0]] || query.companyTypes[0]);
    }

    if (query.countries?.length) {
      const countryName = getCountryDisplayName(query.countries[0]);
      if (countryName) {
        parts.push(`in ${countryName}`);
      }
    }
    
    return parts.join(' ') || 'industrial company';
  }

  // ==================== Places API (New) v1 - SearchText ====================

  /**
   * Places API (New) - Text Search
   * POST https://places.googleapis.com/v1/places:searchText
   */
  private async textSearchNew(
    searchText: string, 
    query: RadarSearchQuery
  ): Promise<PlaceResultNew[]> {
    const body: SearchTextRequest = {
      textQuery: searchText,
      languageCode: 'en',
      pageSize: 20,
    };
    
    // 地区偏置
    if (query.locationBias) {
      body.locationBias = {
        circle: {
          center: {
            latitude: query.locationBias.lat,
            longitude: query.locationBias.lng,
          },
          radius: query.locationBias.radius * 1000, // km to m
        },
      };
    }
    
    // 国家/地区限定
    if (query.countries?.length === 1) {
      body.regionCode = query.countries[0].toUpperCase();
    }
    
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': SEARCH_FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      }
    );
    
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Google Places API (New) error: ${response.status} - ${errText}`);
    }
    
    const data: SearchTextResponse = await response.json();
    
    return data.places || [];
  }

  // ==================== Geocoding API ====================

  /**
   * 正向地理编码：地址 → 坐标
   */
  async geocode(address: string): Promise<GeocodingResultParsed | null> {
    if (!this.apiKey) return null;
    
    const params = new URLSearchParams({
      address,
      key: this.apiKey,
    });
    
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
        { signal: AbortSignal.timeout(this.timeout) }
      );
      
      if (!response.ok) return null;
      
      const data: GeocodingResponse = await response.json();
      
      if (data.status !== 'OK' || !data.results.length) return null;
      
      return this.parseGeocodingResult(data.results[0]);
    } catch (error) {
      console.error('Geocoding failed:', error);
      return null;
    }
  }

  /**
   * 反向地理编码：坐标 → 地址
   */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResultParsed | null> {
    if (!this.apiKey) return null;
    
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: this.apiKey,
    });
    
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
        { signal: AbortSignal.timeout(this.timeout) }
      );
      
      if (!response.ok) return null;
      
      const data: GeocodingResponse = await response.json();
      
      if (data.status !== 'OK' || !data.results.length) return null;
      
      return this.parseGeocodingResult(data.results[0]);
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return null;
    }
  }

  /**
   * 解析 Geocoding 结果为结构化数据
   */
  private parseGeocodingResult(result: GeocodingResult): GeocodingResultParsed {
    let country: string | null = null;
    let countryCode: string | null = null;
    let city: string | null = null;
    let region: string | null = null;

    for (const comp of result.address_components) {
      if (comp.types.includes('country')) {
        country = comp.long_name;
        countryCode = comp.short_name;
      }
      if (comp.types.includes('locality') || comp.types.includes('postal_town')) {
        city = comp.long_name;
      }
      if (comp.types.includes('administrative_area_level_1')) {
        region = comp.long_name;
      }
    }

    return {
      placeId: result.place_id,
      formattedAddress: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      country,
      countryCode,
      city,
      region,
    };
  }

  // ==================== Places 详情 ====================

  /**
   * Places API (New) v1 - Place Details
   * GET https://places.googleapis.com/v1/places/{place_id}
   */
  async getDetails(externalId: string): Promise<{
    externalId: string;
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    description?: string;
    additionalInfo?: Record<string, unknown>;
  } | null> {
    if (!this.apiKey) return null;
    
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${externalId}`,
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': DETAILS_FIELD_MASK,
          },
          signal: AbortSignal.timeout(this.timeout),
        }
      );
      
      if (!response.ok) return null;
      
      const place: PlaceResultNew = await response.json();
      
      return {
        externalId,
        name: place.displayName?.text,
        phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
        website: place.websiteUri,
        address: place.formattedAddress,
        description: place.editorialSummary?.text,
        additionalInfo: {
          rating: place.rating,
          reviewCount: place.userRatingCount,
          types: place.types,
          businessStatus: place.businessStatus,
          googleMapsUrl: place.googleMapsUri,
          lat: place.location?.latitude,
          lng: place.location?.longitude,
        },
      };
    } catch (error) {
      console.error('Failed to get place details:', error);
      return null;
    }
  }

  // ==================== 标准化 ====================

  /**
   * 标准化新版 API 返回结果
   */
  private normalizeNew(place: PlaceResultNew): NormalizedCandidate {
    // 从地址提取国家/城市
    const addressParts = place.formattedAddress?.split(', ') || [];
    const countryPart = addressParts.length > 0 ? addressParts[addressParts.length - 1] : undefined;
    const country = getCountryDisplayName(countryPart) || countryPart;
    const city = addressParts.length > 1 ? addressParts[addressParts.length - 2] : undefined;
    
    // 从 types 推断行业
    const industry = this.inferIndustry(place.types || []);
    
    return {
      externalId: place.id,
      sourceUrl: place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      displayName: place.displayName?.text || '未知企业',
      candidateType: 'COMPANY',
      description: place.editorialSummary?.text,
      
      website: place.websiteUri,
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
      address: place.formattedAddress,
      country,
      city,
      industry,
      
      matchExplain: {
        channel: 'google_places',
        reasons: [
          `Google Maps POI`,
          place.rating ? `评分 ${place.rating}⭐ (${place.userRatingCount || 0} 评)` : undefined,
          place.businessStatus === 'OPERATIONAL' ? '营业中' : undefined,
        ].filter(Boolean) as string[],
      },
      
      rawData: {
        source: 'google_places_new',
        place_id: place.id,
        types: place.types,
        rating: place.rating,
        user_ratings_total: place.userRatingCount,
        business_status: place.businessStatus,
        lat: place.location?.latitude,
        lng: place.location?.longitude,
      },
    };
  }

  /**
   * 兼容旧版 normalize 接口
   */
  normalize(raw: unknown): NormalizedCandidate {
    const place = raw as PlaceResultNew;
    return this.normalizeNew(place);
  }

  /**
   * 从 Google place types 推断行业
   */
  private inferIndustry(types: string[]): string | undefined {
    const industryMap: Record<string, string> = {
      factory: '制造业',
      manufacturing: '制造业',
      industrial: '工业',
      electronics_store: '电子',
      hardware_store: '五金',
      car_dealer: '汽车',
      car_repair: '汽车服务',
      food: '食品',
      construction: '建筑',
      logistics: '物流',
      shipping: '物流',
      chemical: '化工',
      pharmaceutical: '医药',
      technology: '科技',
    };
    
    for (const type of types) {
      const normalizedType = type.toLowerCase().replace(/_/g, '');
      for (const [key, value] of Object.entries(industryMap)) {
        if (normalizedType.includes(key)) {
          return value;
        }
      }
    }
    
    return undefined;
  }

  // ==================== 健康检查 ====================

  async healthCheck(): Promise<HealthStatus> {
    if (!this.apiKey) {
      return {
        healthy: false,
        latency: 0,
        error: 'Google Maps API key not configured (GOOGLE_MAPS_API_KEY)',
      };
    }
    
    const startTime = Date.now();
    
    try {
      // 使用新版 Places API 做一个简单搜索测试
      const body: SearchTextRequest = {
        textQuery: 'test company',
        pageSize: 1,
      };
      
      const response = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        }
      );
      
      const latency = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json() as SearchTextResponse;
        const count = data.places?.length || 0;
        return { 
          healthy: true, 
          latency,
          message: `Places API (New) OK — returned ${count} results`,
        };
      }
      
      const errText = await response.text().catch(() => 'Unknown error');
      return {
        healthy: false,
        latency,
        error: `API error ${response.status}: ${errText}`,
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
