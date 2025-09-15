import PropTypes from 'prop-types'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [20, 0]
const DEFAULT_ZOOM = 2

function FitToMarkers({ points }) {
  const map = useMap()
  const coords = points
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
    .map(p => [p.lat, p.lon])

  if (coords.length === 1) {
    map.setView(coords[0], 14) // single point: nice close zoom
  } else if (coords.length > 1) {
    const bounds = L.latLngBounds(coords)
    map.fitBounds(bounds, { padding: [32, 32] }) // auto-zoom with a little padding
  }
  return null
}

export default function MapView({ points = [], onSelectPoint }) {
  const valid = points.filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
  const center = valid.length ? [valid[0].lat, valid[0].lon] : DEFAULT_CENTER
  const zoom = valid.length ? 8 : DEFAULT_ZOOM // initial; FitToMarkers will adjust

  return (
    <div className="map-card" role="region" aria-label="Map">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom style={{ height: 360, width: '100%' }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* auto-zoom */}
        <FitToMarkers points={valid} />

        {valid.map(p => (
          <Marker key={p.id} position={[p.lat, p.lon]} eventHandlers={{ click: () => onSelectPoint?.(p.id) }}>
            <Popup>
              <strong>{p.name}</strong><br />
              {p.id}
            </Popup>
          </Marker>
        ))}
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
  onSelectPoint: PropTypes.func,
}
