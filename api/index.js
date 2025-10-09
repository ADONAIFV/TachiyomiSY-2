// api/index.js - VERSIÓN DE PRUEBA DE AISLAMIENTO

// El único propósito de este código es ver si la importación de 'sharp' crashea la función.
import sharp from 'sharp';

export default async function handler(req, res) {
  
  console.log("[TEST] La función handler se ha iniciado.");
  
  // Si llegamos aquí, significa que la importación de 'sharp' fue exitosa.
  
  try {
    // Vamos a intentar usar una función mínima de sharp para estar seguros.
    const version = sharp.versions;
    console.log("[TEST] Versión de Sharp detectada:", version);

    // Si todo va bien, devolvemos un mensaje de éxito.
    return res.status(200).json({
      status: "Éxito",
      message: "La librería 'sharp' se ha importado y ejecutado correctamente.",
      sharp_versions: version
    });

  } catch (error) {
    // Si la importación funcionó pero el uso de sharp falla, lo veremos aquí.
    console.error("[TEST CRITICAL ERROR]", { 
        errorMessage: error.message,
        errorStack: error.stack
    });

    return res.status(500).json({
      status: "Fallo en el Test",
      error: "La importación de 'sharp' funcionó, pero su uso falló.",
      details: {
        message: error.message,
        stack: error.stack
      }
    });
  }
}
