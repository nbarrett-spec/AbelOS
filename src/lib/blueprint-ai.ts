/**
 * Blueprint AI Parser — Abel Lumber
 *
 * Uses Claude Vision API to analyze floor plans and extract:
 * - Doors (interior, exterior, closet, pocket, barn, french)
 * - Windows
 * - Rooms (type, estimated sq ft)
 * - Closets (walk-in, reach-in, linen)
 * - Trim/molding requirements
 * - Hardware needs
 *
 * Returns structured JSON for takeoff generation
 */

export interface BlueprintAnalysis {
  rooms: Array<{
    name: string
    type: string // bedroom, bathroom, kitchen, living, garage, etc.
    estimatedSqFt: number
    doors: Array<{ type: string; width: string; quantity: number }>
    windows: Array<{ type: string; quantity: number }>
    closets: Array<{ type: string; width: string }>
  }>
  summary: {
    totalDoors: number
    totalWindows: number
    totalClosets: number
    estimatedTrimLF: number
    floorPlanSqFt: number
    stories: number
    bedrooms: number
    bathrooms: number
  }
  confidence: number // 0-100
  notes: string[] // anything the AI noticed or is unsure about
}

interface AnthropicError {
  type: string
  message: string
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
  error?: AnthropicError
}

const SYSTEM_PROMPT = `You are an expert architectural blueprint analyst specializing in residential construction material takeoffs.

Analyze the provided floor plan image and extract the following information in valid JSON format:

1. For each room, identify:
   - Room name/label
   - Room type (bedroom, bathroom, kitchen, living room, dining room, hallway, garage, laundry, office, etc.)
   - Estimated square footage
   - All doors with their:
     * Type (interior, exterior, closet, pocket, barn, french, bifold, sliding)
     * Width (if visible, e.g., "36", "48")
     * Quantity
   - All windows with their:
     * Type (single-hung, double-hung, sliding, casement, etc.)
     * Quantity
   - All closets with:
     * Type (walk-in, reach-in, linen, coat closet)
     * Width/size if visible

2. Calculate summary statistics:
   - Total door count by type
   - Total window count
   - Total closets count
   - Estimated linear feet of perimeter trim (base, casing, crown)
   - Estimated total floor plan square footage
   - Number of stories
   - Number of bedrooms
   - Number of bathrooms

3. Provide a confidence score (0-100) for your analysis

4. List any notes about uncertainty, unclear elements, or special features

Return ONLY valid JSON matching this exact structure:
{
  "rooms": [
    {
      "name": "string",
      "type": "string",
      "estimatedSqFt": number,
      "doors": [
        { "type": "string", "width": "string", "quantity": number }
      ],
      "windows": [
        { "type": "string", "quantity": number }
      ],
      "closets": [
        { "type": "string", "width": "string" }
      ]
    }
  ],
  "summary": {
    "totalDoors": number,
    "totalWindows": number,
    "totalClosets": number,
    "estimatedTrimLF": number,
    "floorPlanSqFt": number,
    "stories": number,
    "bedrooms": number,
    "bathrooms": number
  },
  "confidence": number,
  "notes": ["string"]
}

Be conservative with confidence scores. If you cannot clearly see door dimensions or room labels, lower confidence accordingly.
Focus on accuracy over completeness.`;

/**
 * Parse a blueprint image using Claude Vision API
 * Accepts either:
 * - imageBase64: raw base64-encoded image data + mediaType
 * - imageUrl: public HTTPS URL to image
 */
export async function analyzeBlueprint(
  imageSource: { type: 'base64'; data: string; mediaType: string } | { type: 'url'; url: string }
): Promise<{ analysis: BlueprintAnalysis; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { analysis: {} as BlueprintAnalysis, error: 'ANTHROPIC_API_KEY not configured' }
  }

  try {
    // Build image content based on source type
    let imageContent: Record<string, unknown>
    if (imageSource.type === 'url') {
      imageContent = {
        type: 'image',
        source: {
          type: 'url',
          url: imageSource.url,
        },
      }
    } else {
      imageContent = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageSource.mediaType,
          data: imageSource.data,
        },
      }
    }

    const response = await Promise.race([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                imageContent,
                {
                  type: 'text',
                  text: SYSTEM_PROMPT,
                },
              ],
            },
          ],
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 60000)
      ),
    ])

    const data: AnthropicResponse = await response.json()

    // Check for API errors
    if (data.error) {
      return {
        analysis: {} as BlueprintAnalysis,
        error: `Claude API error: ${data.error.message}`,
      }
    }

    if (!response.ok) {
      return {
        analysis: {} as BlueprintAnalysis,
        error: `Claude API returned ${response.status}`,
      }
    }

    // Extract JSON from response
    const textContent = data.content?.find((c) => c.type === 'text')?.text
    if (!textContent) {
      return {
        analysis: {} as BlueprintAnalysis,
        error: 'No text response from Claude Vision API',
      }
    }

    // Parse JSON response
    let analysis: BlueprintAnalysis
    try {
      // Try to extract JSON from the response (in case there's surrounding text)
      const jsonMatch = textContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return {
          analysis: {} as BlueprintAnalysis,
          error: 'Could not find JSON in Claude response',
        }
      }
      analysis = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      return {
        analysis: {} as BlueprintAnalysis,
        error: `Failed to parse Claude response as JSON: ${parseError}`,
      }
    }

    // Validate required fields
    if (!analysis.summary || !Array.isArray(analysis.rooms)) {
      return {
        analysis: {} as BlueprintAnalysis,
        error: 'Invalid response structure from Claude',
      }
    }

    return { analysis }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return {
      analysis: {} as BlueprintAnalysis,
      error: `Blueprint analysis failed: ${errorMsg}`,
    }
  }
}

/**
 * Convert base64 image data to format suitable for API
 * Handles PNG, JPG, PDF (first page), and DWG formats
 */
export async function imageToBase64(
  fileBuffer: Buffer,
  fileType: string
): Promise<{ base64: string; mediaType: string }> {
  const base64Data = fileBuffer.toString('base64')

  // Map file extensions to MIME types
  const mimeTypeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    dwg: 'application/pdf', // DWG should be converted to PDF by client
  }

  const mediaType = mimeTypeMap[fileType.toLowerCase()] || 'image/png'

  return {
    base64: base64Data,
    mediaType,
  }
}

/**
 * Estimate trim requirements from room count and dimensions
 * Used as fallback if AI confidence is low
 */
export function estimateTrimLinearFeet(
  rooms: BlueprintAnalysis['rooms'],
  floorPlanSqFt: number
): number {
  // Rule of thumb: ~1 linear foot of trim per 10 sq ft (conservative)
  // Accounts for base, casing around doors/windows, crown if applicable
  const estimatedLF = Math.ceil(floorPlanSqFt / 10)
  return Math.max(estimatedLF, 100) // Minimum 100 LF
}
