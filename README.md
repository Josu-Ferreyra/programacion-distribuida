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

2. Instalar los certificados HTTPS en `/certs`.
```
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 \
  -subj "/CN=localhost"
```

3. Correr servidor Redis.
```
sudo systemctl enable --now redis
```

### Comandos útiles para validar los locks en Redis
```
# Comprobar existencia
EXISTS lock:users:<ID_DEL_USUARIO>

# Consultar el tiempo de vida restante (TTL)
TTL lock:users:<ID_DEL_USUARIO>

# Ver el identificador de propiedad
GET lock:users:<ID_DEL_USUARIO>
```

4. Agregar las variables de entorno en `.env`
```
SSL_KEY_PATH=certs/key.pem
SSL_CERT_PATH=certs/cert.pem
REDIS_URL=redis://localhost:6379
MONGO_URI=mongodb://localhost:27017/tp_distribuida
```

5. Correr MongoDB
```
sudo systemctl start mongodb
```

6. La API quedara disponible en:

```text
https://localhost:3000
```

> Si queres usar otro puerto, defini la variable de entorno `PORT` antes de ejecutar el proyecto.

## Endpoints disponibles

- GET /api/users
- GET /api/users/:id
- POST /api/users
- POST /api/users/:id/savings
- PUT /api/users/:id
- DELETE /api/users/:id

## Ejemplo rapido de prueba

Podrias probar el listado de usuarios con:

```bash
curl https://localhost:3000/api/users
```
