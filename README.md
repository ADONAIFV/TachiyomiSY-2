# Bandwidth Hero: The Definitive Edition 🚀

Este es un servicio de compresión de imágenes personal, hiper-optimizado y robusto. Su única misión es reducir drásticamente el uso de datos al leer manhuas a color a través de Tachiyomi, garantizando la máxima calidad legible con el menor tamaño de archivo posible.

El sistema ha sido diseñado desde cero para operar de forma inteligente dentro de los generosos límites del plan Hobby de Vercel, priorizando la eficiencia de CPU y la fiabilidad a largo plazo.

## 🧠 Filosofía de Diseño

1.  **Optimización Inteligente:** Nunca aplicar una compresión a ciegas. El sistema compite contra la imagen original y solo sirve su versión si es objetivamente mejor (más pequeña).
2.  **Robustez Extrema:** Anticipar todos los puntos de fallo. Desde fuentes lentas y imágenes corruptas hasta formatos inesperados como GIFs, el sistema está diseñado para manejarlo con elegancia.
3.  **Eficiencia de Recursos:** Cada línea de código está pensada para minimizar el consumo de CPU y memoria, respetando los límites del plan gratuito de Vercel para garantizar un funcionamiento perpetuo.
4.  **Experiencia de Usuario:** El objetivo final es una carga fluida y sin errores en Tachiyomi. Las imágenes fallidas no rompen la experiencia; se muestran como errores claros.

## ✨ Características Clave

Este no es un simple compresor. Es un sistema integral con múltiples capas de inteligencia:

*   ✅ **Compresión Extrema con AVIF:** Utiliza el formato AVIF de última generación con cuantización de color para lograr reducciones de tamaño masivas (típicamente 80-95%) en manhuas a color, manteniendo una legibilidad perfecta.
*   🧠 **Lógica de Optimización Inteligente:** **Garantía "No Empeorar"**. El sistema analiza la imagen original y la comprimida, y sirve automáticamente la que sea más pequeña. Se acabaron los casos en los que un WebP optimizado se convierte en un AVIF más grande.
*   ✂️ **Recorte Automático de Bordes (`Auto-Trim`):** Detecta y elimina automáticamente los bordes blancos o negros innecesarios de cada página, ahorrando datos y mejorando la visualización sin pérdida de contenido.
*   🦎 **Evasión Avanzada de Bloqueos (Modo Camaleón):** Utiliza un conjunto de headers HTTP hiperrealistas para simular un navegador moderno, superando la mayoría de las protecciones anti-bots y Cloudflare.
*   🛡️ **Sistema Anti-Errores Robusto:** Si una imagen de origen está corrupta, no se puede acceder o causa un error de procesamiento, el sistema no falla. En su lugar, sirve una imagen de "error" predefinida, evitando que las descargas en Tachiyomi se interrumpan.
*   🔬 **Modo de Depuración Integrado:** Permite diagnosticar problemas con cualquier imagen añadiendo `&debug=true` a la URL, obteniendo un informe JSON completo sobre el proceso de decisión.
*   ⚙️ **Protección de Recursos Integrada:**
    *   **Límite de Tamaño de Entrada:** Rechaza procesar imágenes excesivamente grandes ( > 30MB) para proteger el uso de CPU.
    *   **Timeout Agresivo:** Cancela las peticiones a servidores de origen lentos después de 15 segundos para evitar agotar el tiempo de ejecución de la función.
*   🖥️ **Interfaz de Pruebas en Vivo:** La página principal del servicio es una UI intuitiva para probar la compresión en tiempo real, comparar el antes y el después, y ver las estadísticas de ahorro.

## 🛠️ Stack Tecnológico

*   **Hosting:** [Vercel](https://vercel.com/) (Serverless Functions)
*   **Backend:** [Node.js](https://nodejs.org/)
*   **Procesamiento de Imágenes:** [Sharp](https://sharp.pixelplumbing.com/)
*   **Peticiones HTTP:** [Node-Fetch](https://github.com/node-fetch/node-fetch)

## 🚀 Despliegue en Vercel (2 Minutos)

Desplegar tu propia copia de este servicio es increíblemente simple.

1.  **Crea un Repositorio en GitHub:**
    *   Crea un nuevo repositorio (puede ser público o privado).
2.  **Sube los Archivos del Proyecto:**
    *   Añade todos los archivos (`api/`, `public/`, `package.json`, `vercel.json`) a tu repositorio.
    ```bash
    git init
    git add .
    git commit -m "Initial commit"
    git branch -M main
    git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
    git push -u origin main
    ```
3.  **Importa el Proyecto en Vercel:**
    *   Regístrate o inicia sesión en [vercel.com](https://vercel.com/).
    *   Haz clic en "Add New..." → "Project".
    *   Importa tu repositorio de GitHub recién creado.
    *   Vercel detectará automáticamente la configuración. Simplemente haz clic en **Deploy**.

¡Listo! En unos momentos, tu servicio estará online en la URL que Vercel te proporcione (ej: `https://tu-proyecto.vercel.app`).

## 📱 Uso del Servicio

### Con Tachiyomi
1.  Abre la aplicación y ve a la configuración de la extensión que usa un servidor de imágenes (ej. "MangaDex" o similar que lo permita).
2.  En el campo "Image server" o "Servidor de imágenes", pega la URL principal de tu proyecto desplegado.
    *   **URL:** `https://tu-proyecto.vercel.app`

### Con la Interfaz Web
Simplemente abre la URL principal (`https://tu-proyecto.vercel.app`) en tu navegador para acceder al tester visual.

## 🔧 Pruebas y Depuración

Si una imagen específica no carga o se ve mal, puedes usar el modo de depuración para entender qué está pasando.

**Ejemplo de uso:**
Pega esta URL en tu navegador o úsala con una herramienta como `curl`:
```bash
curl "https://tu-proyecto.vercel.app/?url=URL_DE_LA_IMAGEN_PROBLEMÁTICA&debug=true"