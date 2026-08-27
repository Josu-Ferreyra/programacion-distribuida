# API REST - Guia de instalacion y ejecucion

Este proyecto es una API REST hecha con Node.js y Express.

## Requisitos previos

- Node.js 18 o superior
- npm (viene con Node.js)

## Instalacion

1. Descomprimir el RAR del proyecto:

2. Instalar dependencias:

```bash
npm install
```

## Ejecucion

1. Iniciar el servidor en modo desarrollo (con recarga por cambios):

```bash
npm start
```

2. La API quedara disponible en:

```text
http://localhost:3000
```

> Si queres usar otro puerto, defini la variable de entorno `PORT` antes de ejecutar el proyecto.

## Endpoints disponibles

- GET /api/users
- GET /api/users/:id
- POST /api/users
- PUT /api/users/:id
- DELETE /api/users/:id

## Ejemplo rapido de prueba

Podrias probar el listado de usuarios con:

```bash
curl http://localhost:3000/api/users
```
