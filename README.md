
# Bandwidth Hero: The Hybrid Engine ⚡

> **La solución definitiva de compresión de manga para Tachiyomi/Mihon.**
> Arquitectura Híbrida: Photon CDN + Vercel Smart Processing.

Este servicio no es un simple proxy. Es un **"Guardián de Peso"** inteligente diseñado para leer Manhuas a color con la máxima calidad posible y el mínimo consumo de datos, protegiendo al mismo tiempo la cuota de CPU de tu cuenta gratuita de Vercel.

## 🧠 La Arquitectura "Guardián de Peso"

El sistema opera bajo una lógica de **filtrado activo** en dos fases. Ya no comprime a ciegas; toma decisiones basadas en el peso real de la imagen.

### 🌊 Flujo de Trabajo

1.  **Fase 1: La Trituradora (Photon CDN)**
    *   Todas las peticiones pasan primero por la infraestructura global de WordPress (Photon).
    *   **Acción:** Descarga la imagen original, la redimensiona a **720px** y la convierte a **WebP Q60**.
    *   **Costo de CPU:** 0%.

2.  **Fase 2: La Báscula (Vercel Logic)**
    *   Tu servidor recibe la imagen optimizada de Photon y la pesa.
    *   **¿Pesa < 100 KB?** ✅ **APROBADO.** Se envía tal cual al usuario. (Gasto CPU: 0).
    *   **¿Pesa > 100 KB?** ⚠️ **ALERTA.** Se activa el motor local.

3.  **Fase 3: La Compresión Nuclear (Solo si es necesario)**
    *   Si la imagen supera los 100KB, Vercel la procesa con **Sharp**.
    *   **Acción:** Convierte a **AVIF**, Calidad **25**, Chroma **4:4:4** (Texto Nítido).
    *   **Resultado:** Una imagen que pesaba 150KB baja a 40KB.

## ✨ Características Clave

*   🚀 **Modo Híbrido Automático:** Usa WebP para imágenes sencillas y AVIF para las complejas.
*   🛡️ **Protección de CPU:** El 85-90% de las imágenes son procesadas por Photon. Vercel solo trabaja cuando es estrictamente necesario.
*   👁️ **Smart Text Protection:** Cuando Vercel interviene, usa submuestreo de color `4:4:4` para evitar que el texto rojo/azul sobre fondo negro se vea borroso.
*   📏 **Estandarización Móvil:** Todo se entrega a un ancho máximo de **720px**, el estándar perfecto para lectura en smartphones.
*   🧱 **Anti-Bloqueo Robusto:** Al usar Photon como intermediario, saltamos la mayoría de los bloqueos 403 (Leercapitulo, Mangacrab, etc.).
*   🛟 **Fail-Safe:** Si todo falla, el sistema redirige automáticamente a la imagen original. Nunca verás un error de "Imagen Rota".

## 🛠️ Stack Tecnológico

*   **Core:** Node.js (Vercel Serverless Functions)
*   **Motor Gráfico:** Sharp (libvips)
*   **CDN Externa:** Photon (i0.wp.com)
*   **Cliente HTTP:** Node-Fetch

## 🚀 Despliegue en Vercel

1.  Haz un **Fork** o sube este repositorio a tu GitHub.
2.  Importa el proyecto en **Vercel**.
3.  ¡Listo! No requiere configuración de variables de entorno.

## 📱 Configuración en Tachiyomi / Mihon

1.  Ve a la configuración de la extensión (ej. MangaDex, o cualquiera que permita servidor de imágenes personalizado).
2.  En **"Image Server"** o **"Proxy URL"**, coloca la dirección de tu proyecto:
    ```
    https://TU-PROYECTO.vercel.app/api/compress?url=
    ```
    *(Nota: Algunas extensiones añaden la URL automáticamente, otras requieren el prefijo completo)*.
