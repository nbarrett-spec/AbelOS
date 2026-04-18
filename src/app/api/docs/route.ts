import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export async function GET() {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Abel Lumber API Documentation</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@3.54.0/swagger-ui.css" />
        <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@3.54.0/favicon-32x32.png" sizes="32x32" />
        <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@3.54.0/favicon-16x16.png" sizes="16x16" />
        <style>
          html {
            box-sizing: border-box;
            overflow: -moz-scrollbars-vertical;
            overflow-y: scroll;
          }

          *, *:before, *:after {
            box-sizing: inherit;
          }

          body {
            margin: 0;
            padding: 0;
            font-family: sans-serif;
            background: #fafafa;
          }

          .topbar {
            background-color: #1a202c;
            padding: 10px 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid #ccc;
          }

          .topbar h1 {
            margin: 0;
            color: white;
            font-size: 24px;
            font-weight: 600;
          }
        </style>
      </head>

      <body>
        <div class="topbar">
          <h1>Abel Lumber Builder Platform - API Documentation</h1>
        </div>
        <div id="swagger-ui"></div>

        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@3.54.0/swagger-ui-bundle.js" charset="UTF-8"></script>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@3.54.0/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
        <script>
          const ui = SwaggerUIBundle({
            url: '/openapi.yaml',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [
              SwaggerUIBundle.presets.apis,
              SwaggerUIStandalonePreset
            ],
            plugins: [
              SwaggerUIBundle.plugins.DownloadUrl
            ],
            layout: 'StandaloneLayout',
            defaultModelsExpandDepth: 1,
            defaultModelExpandDepth: 1,
            docExpansion: 'list',
            filter: true,
            tryItOutEnabled: true,
            requestInterceptor: (request) => {
              // Add any default headers if needed
              return request
            },
            responseInterceptor: (response) => {
              return response
            },
            onComplete: () => {
              console.log('Swagger UI initialized')
            },
            onFailure: (error) => {
              console.error('Failed to load API spec:', error)
            }
          })

          window.ui = ui
        </script>
      </body>
    </html>
  `

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
