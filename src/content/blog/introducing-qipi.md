---
title: "Qipi: el gestor de paquetes más rápido para Node.js — sin node_modules, instántaneo y seguro"
description: "Se presenta Qipi, un gestor de paquetes extremadamente rápido para Node.js, escrito en Rust. Sin node_modules. Compatible con todo el ecosistema."
pubDate: "2025-07-16"
slug: "introducing-qipi"
tags: ["project", "rust"]
heroImage: "../assets/qipi-banner.png"
---

Históricamente todos los gestores de paquetes de Node.js han intentado innovar en el manejo de dependencias. Algunos, como [pnpm](https://pnpm.io), optaron por emplear arquitecturas más eficientes, usando _symlinks_ y cachés centralizadas, reduciendo el espacio necesario en disco y optimizando los tiempos de instalación. Pero, a pesar de sus mejoras, sigue teniendo la misma problemática general: la dependencia a `node_modules`. Esta estructura presenta ciertos inconvenientes:

- • Genera un grafo demasiado complejo de dependencias
- • Obliga al gestor a manejar casos excepcionales como referencias cíclicas
- • Infla el repositorio local con cientos o miles de archivos y directorios
- • El _resolver_ debe buscar recursivamente, decayendo en un cómputo `O(n)` o peor

[Yarn PnP](https://yarnpkg.com) intentó resolverlo creando un sistema de archivos por encima de una caché ZIP, donde se genera un archivo `.pnp.cjs` **por cada proyecto** con su grafo de dependencias incrustado. Luego, este archivo se carga como un _loader_ personalizado en Node.js, interceptando las llamadas a `require()`. Aunque es un adelanto, podría tener mejoras técnicas y críticas que pueden aumentar el rendimiento, eficiencia en disco y compatibilidad con el ecosistema significativamente. Ese es el objetivo de **Qipi**.

---

## 👋 Introducción

[**Qipi**](https://github.com/qipkg/qipi) es un gestor de paquetes extremadamente rápido, muy eficiente en disco, seguro y determinista para Node.js, escrito en Rust. Sigue la arquitectura conceptual de Yarn PnP, en su filosofía de "cero `node_modules`", pero con cambios y mejoras importantes en su implementación. Algunas de sus características generales son:

- • Sin `node_modules`
- • Sin `.pnp.cjs` ni carpetas ocultas: **el repositorio queda limpio**
- • Compatibilidad total con el ecosistema de JavaScript, incluidas herramientas de desarrollo
- • Una única instalación por paquete, deduplicada por siempre e indexada
- • Resoluciones de dependencias instantáneas, por debajo del milisegundo
- • Fácil, intuitivo y rápido de usar
- • Instalaciones de proyectos completos en menos de un segundo
- • Soporte a workspaces _plug-and-play_ y escalables
- • 100% multiplataforma

Para conseguirlo, **Qipi** aplica optimizaciones agresivas, incluidas mapeo perezoso en memoria (`mmap`) del grafo de dependencias, formatos binarios, indexación `O(1)` para todo paquete solicitado, caché centralizada y deduplicada, _loader_ de Node.js escrito en Rust, montaje virtual para retrocompatibilidad, entre otras. En este post se va a repasar toda la arquitectura presentada, junto al proyecto.

---

## 🤔 ¿Sin `node_modules`?

Seguramente una de las preguntas más reiterativas es y será _"¿por qué y cómo no hay node_modules?"_. Esta decisión se debe a las razones dadas al principio, sumado a que implementar un gestor que lo utilice es más complejo y pesado en comparación de evitarlo.

Primero hay que presentar cómo se inicia un proyecto en **Qipi**, donde se podrá ver cómo se estructura un repositorio. Lo primero es crear el directorio e iniciar el `shell`; _"¿el shell?"_, sí.

```bash
qp new hello-world
cd hello-world
qp shell
```

Creamos la carpeta con `qp new name`. Esto va a hacer un _scaffold_ **minimo y muy limpio**, parte de la filosofía de **Qipi**.

```text
📦hello-world
 ┣ 📜package.json
 ┗ 📜package.lock
```

El archivo `package.json` es donde se centraliza toda la configuración del proyecto, mientras que en el `package.lock` se creará el grafo binario de dependencias, usado para resolverlas de forma determinista, rápida y segura. Nada más.

Luego, entramos al directorio con `cd name` y ejecutamos `qp shell`, acá es donde empiezan las diferencias. **Qipi** utiliza un _resolver_ personalizado para que Node.js pueda saber dónde se almacenan las dependencias, ya que por defecto las buscará en `node_modules`, y al no existir, lanzará un error. 

El comando `qp shell` superpone el `$PATH` para que las llamadas a `node` incluyan una _flag_ `--import` y `--require`, apuntando al _loader_ personalizado. Esto se aplica **solo a la sesión actual del shell**, si abre una nueva terminal no se mantendrá el cambio, por lo que es seguro al **no** modificar estados globales.

Dependiendo del sistema operativo y _shell_ en uso, se usará un _**shim**_ diferente, todos localizados en `$HOME/.qipi/shims/<os>/shim-<shell>.*`.

Ahora vamos a añadir una dependencia. Por ejemplo, [ms](https://npmjs.com/package/ms).

```bash
qp add ms
```

Esto no tomará más de **300ms**. Pero, lo más sorprendente es que no aparecerá nada nuevo en el repositorio, más que cambiaron `package.json` y `package.lock` para registrar la nueva dependencia. El flujo de instalación interno fue el siguiente:

```mermaid
flowchart TD
  classDef default fill:transparent,stroke:#fff,stroke-width:2px,color:#fff,font-weight:bold,font-size:15px;
  class qpAdd,checkStore,condExist,writeLock,buildDAG,downloadDeps,checkSubDeps,updateLock,updateMmap default;

  linkStyle default stroke:#fff,stroke-width:2px;

  qpAdd(["Ejecuta qp add ms"])
  checkStore(["Verifica en el store global el paquete ms@latest"])
  condExist{"¿Existe ms@latest?"}
  
  writeLock(["Escribe en package.lock y package.json"])
  buildDAG(["Arma grafo DAG de dependencias"])
  downloadDeps(["Descarga en store global descomprimido"])
  checkSubDeps(["Verifica sub-dependencias"])
  updateLock(["Actualiza package.lock y package.json"])

  qpAdd --> checkStore --> condExist
  condExist -- Sí --> writeLock
  condExist -- No --> buildDAG --> downloadDeps --> checkSubDeps --> updateLock

  condExist --- writeLock
  condExist --- buildDAG
```

El único I/O que se involucra es en la ausencia de un paquete en el [_store_ global](#-caché-global), descargándolo y posteriormente registrándolo en el indexado del `package.lock` del proyecto. En caso de que ya esté descargado, únicamente es lo segundo.

Esto permite tiempos extremadamente rápidos, practicamente inmediatos, de instalación. Además, se mantiene siempre limpio el repositorio, sin grandes estructuras de directorios y archivos anidados que inflan el _tree_ local.

---

## 📃 Resolución de dependencias

Ahora hay otra incógnita a responder: _"Sin un node_modules, ¿cómo hace Node.js para resolver las dependencias?"_. Ya se dió pistas, pero ahora vamos a profundizar: el _resolver_ personalizado de **Qipi**.

Se dijo anteriormente que `qp shell` modificaba el `$PATH` de la sesión del _shell_ actual para interponer un `node` con las flags `--import` y `--require`. Esto permite, entre otras cosas, poder usar lo siguiente para ejecutar un proyecto:

```bash
node .
```

¡Sí! Puede ejecutar normalmente un proyecto JavaScript sin tener que llamar a `<pkgm> node .` (como Yarn) todo el tiempo, sin necesidad de grandes _wrappers_. Pero, ¿cómo funciona internamente?

Los _resolvers_ personalizados de módulos se introdujeron a Node.js en el año **2023** con [la versión **v20.6.0**](https://nodejs.org/en/blog/release/v20.6.0#new-nodemodule-api-register-for-module-customization-hooks-new-initialize-hook), permitiendo modificar la lógica de resolución de módulos para cargar archivos de forma personalizada o con extensiones no estándar.

En el caso de **Qipi**, los _resolvers_ están localizados en `$HOME/.qipi/loaders/loader-esm.mjs` (**EcmaScript Modules, `--import`**) y `$HOME/.qipi/loaders/loader-common.cjs` (**CommonJS, `--require`**).

### 📂 Lógica de carga

Tradicionalmente, los tiempos de carga suelen ser computados en `O(n)` o peor, debido a la estructura `node_modules`, que obliga a recorrer recursivamente. **Qipi** provee un nuevo algoritmo de resolución con complejidad `O(1)`, lo que vuelve instantáneo servir dependencias _on-demand_.

Esto es gracias al mapeo perezoso del _lockfile_ en memoria. [El formato del `package.lock`](#-lockfile) está diseñado para ser compatible con `mmap`. Al inicio del _resolver_ se carga una única vez el grafo de dependencias en memoria. Cada dependencia tiene un `MPHF` (_Minimal Perfect Hash Function_), que se usa de indice para acceder en `O(1)` a su _offset_ en memoria. Con el _offset_ obtenido, se accede a esa dirección en el grafo cargado en `mmap`, la cual retorna la ruta absoluta de la dependencia en el _store_.

Al ser _lazy-loading_, la paginación solo se hace para las dependencias en demanda, evitando gasto de memoria en exceso. Solo se usa lo que se necesita. `mmap` habilita un mapeo _heap-less_, aumentando significativamente el rendimiento.

Todo esto se hace en una librería **Rust**, expuesta a JavaScript mediante [napi-rs](https://napi.rs). Aunque el _FFI_ tiene cierto coste, este es ínfimo, más si se optimiza el traspaso de datos con canales _zero-copy_. Lo único que se envía y devuelve son los identificadores `name@version` y la ruta absoluta de cada dependencia: _slices_ de bytes.

---

## 🤖 Retrocompatibilidad

Uno de los mayores retos al prescindir del `node_modules` es mantener la retrocompatibilidad con herramientas heredadas. Algunos sistemas como `esbuild` y `vite` leen explicitamente y esperan una estructura `node_modules` en el proyecto, lo que rompe la compatibilidad con gestores de paquetes como Yarn PnP, necesitando de _hacks_ poco convencionales. **Qipi lo resuelve.**

En caso de que requiera compatibilidad, como se mencionó, solo deberá ejecutar el siguiente comando:

```bash
qp mount
```

Internamente, `qp mount` utiliza **FUSE** (Linux/macOS) o **WinFSP** (Windows), para montar un `node_modules` en **memoria**, sin gastar espacio en disco. Esta capa de virtualización intercepta las _syscalls_ de cualquier herramienta (como `vite`), redirigiendo en un `resolver` propio las rutas del `node_modules` al _store_ global de **Qipi**, también en `O(1)`. El _overhead_ de la capa de virtualización es minimo, añadiendo entre 2ms a 5ms, a cambio de la retrocompatibilidad completa con el ecosistema de Node.js.

Si quiere desmontar esta estructura virtual, puede usar:

```bash
qp umount
```

Y se destruirá el `node_modules` en memoria de ese proyecto. Al instante.

---

## 🔒 _Lockfile_

A fin de reconstruir las dependencias de cada proyecto, es necesario guardar un grafo de forma determinista, segura y rápida; en **Qipi**, esto se logra con el `package.lock`. Vamos a ver cómo está hecho.

Como se explicó en [la lógica de carga](#-lógica-de-carga), el _lockfile_ es mapeado en memoria, por lo que es importante tener un formato compatible directamente con `mmap`. El archivo está dividido en tres secciones:

```text
┌─────────────────────────────┐
│ Header del archivo          │ ← version, hash algo, cantidad de entradas, offsets
├─────────────────────────────┤
│ Índice MPHF de dependencias │ ← minimal perfect hash (MPFF): name@version → offset
├─────────────────────────────┤
│ Tabla de Nodos (DAG)        │ ← grafo actual: version, path resuelto, deps[]
└─────────────────────────────┘
```

> **Nota:** Si desea leerlo, puede transformar el _lockfile_ a un formato como `JSON`, `YAML` y `TOML` con el comando `qp lock --to <format>`. Debe tener en cuenta que **Qipi** no lee estos formatos, solo el `package.lock` binario original.

### 📋 Header del archivo

La lectura del _lockfile_ empieza por el _header_. Esta sección contiene los metadatos necesarios para interpretar el resto.

- • `magic`: _string_ "mágico" (`b"QIPILOCK"`) para validar el formato.
- • `version`: versión del formato del _lockfile_.
- • `hash_algo`: identificador del algoritmo de _hash_ usado en el índice.
- • `entry_count`: cantidad total de nodos (dependencias) en el grafo.
- • `mphf_offset`: _offset_ donde comienza la tabla MPHF.
- • `node_table_offset`: _offset_ donde comienza la tabla de nodos.

Esto permite mapear con punteros de forma directa el contenido de las siguientes dos secciones, sin necesidad de _parsing_ línea a línea.

### 📑 Índice MPHF

Se usa un _Minimal Perfect Hash Function_ (`MPHF`) para mapear cada `name@version` a un _offset_ dentro de la [tabla de nodos](#-tabla-de-nodos). Esto permite que el acceso a las dependencias sea computado en `O(1)`, sin colisiones ni estructuras de datos complejas.

- • `Clave del hash`: _string_ `name@version`, codificado como UTF-8.
- • `Valor`: _offset_ absoluto (`u32`, `u64`) relativo al inicio del nodo (dependencia).

La idea con el `MPHF` es que, al generarse el grafo de forma inmutable y persistente en tiempo de instalación (antes de _runtime_), se pueden precomputar todos los conjuntos de claves para mejorar el rendimiento y evitar calculos costosos en tiempo de ejecución del _loader_.

### 🔗 Tabla de nodos

La tabla de nodos representa el grafo dirigido acíclico (`DAG`) de dependencias. Cada entrada es un paquete único (`name@version`) y tiene:

- • `id`: identificador secuencial o hash del nodo.
- • `name`: nombre del paquete.
- • `version`: versión exacta.
- • `resolved_path`: path absoluto o relativo al paquete instalado.
- • `deps`: lista de _offsets_ a otras entradas en esta tabla (representan las dependencias directas).
- • **(opcional)** `integrity`, `tarball_url`, `flags`, `size`, `type_packaging`, etc.

Este diseño permite que, al hacer _load_ de un paquete raíz, se puedan recorrer todas sus dependencias de forma descendente usando solo los _offsets_. No es necesario reconstruir el grafo, usar `JSON` o deserializar nada.

---

## 🌎 Caché global

**Qipi** almacena todas las dependencias en una caché (_store_) centralizada y deduplicada. Se localiza en `$HOME/.qipi/store` y su estructura está diseñada para ser plana y rápida de acceder.

```text
📦.qipi
 ┗ 📂store
 ┃ ┣ 📂name@version1
 ┃ ┗ 📂name@version2
```

Cada versión de las dependencias es una carpeta, por lo que permite hacer _lookup_ inmediato al combinarla simplemente con el nombre. Dentro de cada directorio, se agrega en tiempo de instalación un archivo `.qipi-store-info` en formato binario que almacena información extra como el `integrity`, usada para verificaciones de seguridad y otras operaciones concurrentes.

### 🗑️ Limpieza

Puede limpiar la caché de tres formas diferentes: **por dependencia**, **de forma total** y **automáticamente**. 

La primer manera sirve para eliminar dependencias especificas.

```bash
qp store -r dep # qp store --remove dep
```

La segunda sirve para eliminar **todas las dependencias** del _store_.

```bash
qp store -c # qp store --clean
```

Y la tercera habilita un mecanismo de **recolección de basura** automático.

```bash
qp store gc --enable # o para desactivar: qp store gc --disable
```

Cada vez que ejecute un comando (`qp add`, `qp remove`, `qp install`, etc.) el recolector verificará los `use_timestamp`, que guardan la última fecha de uso de esa dependencia en un proyecto, almacenados en el `.qipi-store-info` de cada paquete. Si superan cierto umbral, los eliminará.

El umbral es configurable con el siguiente comando:

```bash
qp store gc -t 30d # qp store gc --threshold 30d
```

Los tiempos se deben expresar con sufijos: `min` (minutos), `h` (horas), `d` (días), `w` (semanas), `m` (meses).

---

## 📦 _Workspaces_

Los _workspaces_ son una característica muy importante en la escalabilidad de proyectos. **Qipi** centraliza toda la configuración en un único archivo `workspace.json`. Puede crearlo manualmente, o usar en un repositorio el siguiente comando:

```bash
qp init -w # qp init --workspace
```

Ahora puede listar los paquetes de la siguiente forma:

```json
{
  "members": ["packages/*"]
}
```

Luego, en la carpeta `packages`, puede empezar a crear sus miembros del _workspace_. Por ejemplo:

```
📦hello-world
 ┣ 📂packages
 ┃ ┣ 📂bar
 ┃ ┃ ┣ 📜package.json
 ┃ ┃ ┗ 📜package.lock
 ┃ ┗ 📂foo
 ┃ ┃ ┣ 📜package.json
 ┃ ┃ ┗ 📜package.lock
 ┣ 📜package.json
 ┣ 📜package.lock
 ┗ 📜workspace.json
```

Para agregar una dependencia a un paquete en especifico, use el siguiente comando:

```bash
qp add lodash -p bar # qp add lodash --package bar
```

En el caso de que sea un paquete interno del _workspace_, debe añadir explícitamente el prefijo.

```bash
qp add workspace:foo -p bar # qp add workspace:foo --package bar
```

---

## 🤝 Contribuciones

**Qipi** está en constante desarrollo. Si le interesó el proyecto, puede revisarlo en el [repositorio de GitHub](https://github.com/qipkg/qipi) y la [página web oficial](https://qipi.pages.dev). Todas las contribuciones son bienvenidas. **¡Gracias por leer!**