-- Migración 0005: datos de referencia. No contiene publicaciones, horarios ni credenciales.

INSERT INTO categories (id, name, description, sort_order) VALUES
  ('institucional',  'Noticias institucionales', 'Comunicados y novedades de la Comuna', 1),
  ('agua',           'Cortes de agua',           'Interrupciones del suministro de agua', 2),
  ('energia',        'Cortes de energía',        'Interrupciones del servicio eléctrico', 3),
  ('calles',         'Calles cortadas',          'Cortes de calles, rutas y desvíos', 4),
  ('meteorologica',  'Alertas meteorológicas',   'Avisos por clima y fenómenos', 5),
  ('eventos',        'Eventos y festividades',   'Fiestas, actos y celebraciones', 6),
  ('deportes',       'Actividades deportivas',   'Torneos, clubes y competencias', 7),
  ('cultura',        'Cultura',                  'Música, talleres, muestras y tradiciones', 8),
  ('educacion',      'Educación',                'Escuelas, inscripciones y clases', 9),
  ('salud',          'Salud',                    'Campañas, vacunación y atención', 10),
  ('obituarios',     'Obituarios',               'Comunicados fúnebres verificados', 11),
  ('otros',          'Otros avisos comunitarios','Avisos que no encajan en otra categoría', 12);

-- Fuentes oficiales. Quedan DESHABILITADAS y sin configurar: no hay credenciales de Meta.
INSERT INTO sources (id, kind, name, url, mode, enabled, status) VALUES
  ('facebook-comuna',  'facebook',  'Comuna de Río Seco · Facebook',  'https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/', 'manual', 0, 'not-configured'),
  ('instagram-comuna', 'instagram', 'Comuna de Río Seco · Instagram', 'https://www.instagram.com/comunaderioseco/', 'manual', 0, 'not-configured'),
  ('manual',           'manual',    'Redacción Río Seco Conecta',      NULL, 'manual', 1, 'ok');

INSERT INTO radios (id, name, frequency, site_url, tagline) VALUES
  ('activa-1031', 'Radio Activa', '103.1 FM', 'https://www.activa1031.fmmiradio.com/', 'Sitio oficial de la emisora'),
  ('sudamericana-893', 'Radio Sudamericana', '89.3 FM', 'https://www.sudamericana893.com.ar/radio.php', 'Sitio oficial de la emisora');

INSERT INTO bus_localities (id, name, status, reference_url) VALUES
  ('concepcion', 'Concepción', 'sin-datos', 'https://colectivostucuman.com.ar/horarios/rio-seco/concepcion?dia=weekday'),
  ('monteros', 'Monteros', 'sin-datos', NULL),
  ('san-miguel-de-tucuman', 'San Miguel de Tucumán', 'sin-datos', NULL);
