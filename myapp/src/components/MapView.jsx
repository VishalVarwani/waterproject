import PropTypes from 'prop-types'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [20, 0]
const DEFAULT_ZOOM = 2

// Icons
const blueIcon = new L.Icon({
  iconUrl: 'https://www.freeiconspng.com/uploads/blue-location-icon-png-19.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28],
})

const yellowIcon = new L.Icon({
  iconUrl: '/markers/map-pin.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28],
})

const redIcon = new L.Icon({
  iconUrl: '/markers/placeholder.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28],
});

function iconForStatus(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'warn' || s === 'warning' || s === 'watch') return yellowIcon
  if (s === 'alert' || s === 'unsafe') return redIcon
  return blueIcon
}

function FitToMarkers({ points }) {
  const map = useMap()
  const coords = points
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
    .map(p => [p.lat, p.lon])

  if (coords.length === 1) {
    map.setView(coords[0], 14)
  } else if (coords.length > 1) {
    const bounds = L.latLngBounds(coords)
    map.fitBounds(bounds, { padding: [32, 32] })
  }
  return null
}

export default function MapView({ points = [], statusById = {}, onSelectPoint }) {
  const valid = points.filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
  const center = valid.length ? [valid[0].lat, valid[0].lon] : DEFAULT_CENTER
  const zoom = valid.length ? 8 : DEFAULT_ZOOM

  return (
    <div className="map-card" role="region" aria-label="Map">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom style={{ height: 360, width: '100%' }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitToMarkers points={valid} />

        {valid.map(p => {
          const status = statusById[p.id] || 'safe'
          const icon = iconForStatus(status)
          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lon]}
              icon={icon}
              eventHandlers={{ click: () => onSelectPoint?.(p.id) }}
            >
              <Popup>
                <strong>{p.name}</strong><br />
                {p.id}<br />
                <em>Status: {String(status)}</em>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>

      {!valid.length && (
        <div className="muted small" style={{ marginTop: 8 }}>
          No coordinates available for sampling points yet. Markers will appear once lat/lon are provided.
        </div>
      )}
    </div>
  )
}

MapView.propTypes = {
  points: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    lat: PropTypes.number,
    lon: PropTypes.number,
  })),
  // Map from pointId -> 'safe' | 'warn' | 'unsafe' (or 'ok'|'watch'|'alert')
  statusById: PropTypes.object,
  onSelectPoint: PropTypes.func,
}
