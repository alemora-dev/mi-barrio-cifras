/**
 * El Latido Nacional - Dynamic Dashboard Experience
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. UI Elements ---
    const sidePanel = document.getElementById('side-panel');
    const closeBtn = document.getElementById('close-panel');
    const heroOverlay = document.getElementById('hero-overlay');
    const loadingSpinner = document.getElementById('loading-spinner');
    const panelContent = document.getElementById('panel-content');

    // Data UI
    const titleEl = document.getElementById('municipio-title');
    const countEl = document.getElementById('contratos-count');
    const totalEl = document.getElementById('contratos-total');

    // Chart
    const ctx = document.getElementById('mainChart').getContext('2d');
    let myChart = null; // Will be initialized when data is fetched

    // --- 2. MapLibre Initialization ---
    // Start with a view of whole Colombia
    const map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [-74.2973, 4.5709],
        zoom: 4.8,
        pitch: 0,
        bearing: 0,
        interactive: true // Interactive enabled for the dashboard
    });

    // --- 3. GeoJSON Layers & Interactivity ---
    let hoveredStateId = null;

    map.on('load', () => {
        // Add Colombia Departments GeoJSON
        map.addSource('colombia', {
            'type': 'geojson',
            'data': 'https://gist.githubusercontent.com/john-guerra/43c7656821069d00dcbc/raw/be6a6e239cd5b5b803c6e7c2ec405b793a9064dd/Colombia.geo.json',
            'generateId': true // Important for feature state (hover)
        });

        // Add the fill layer for clicking and fading
        map.addLayer({
            'id': 'colombia-fill',
            'type': 'fill',
            'source': 'colombia',
            'paint': {
                'fill-color': '#38bdf8',
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.3, // Opacity on hover
                    0.05 // Opacity by default
                ]
            }
        });

        // Add the line layer for borders
        map.addLayer({
            'id': 'colombia-borders',
            'type': 'line',
            'source': 'colombia',
            'paint': {
                'line-color': '#818cf8',
                'line-width': 1,
                'line-opacity': 0.6
            }
        });

        // Hover Effect Handlers
        map.on('mousemove', 'colombia-fill', (e) => {
            if (e.features.length > 0) {
                map.getCanvas().style.cursor = 'pointer';
                if (hoveredStateId !== null) {
                    map.setFeatureState({ source: 'colombia', id: hoveredStateId }, { hover: false });
                }
                hoveredStateId = e.features[0].id;
                map.setFeatureState({ source: 'colombia', id: hoveredStateId }, { hover: true });
            }
        });

        map.on('mouseleave', 'colombia-fill', () => {
            map.getCanvas().style.cursor = '';
            if (hoveredStateId !== null) {
                map.setFeatureState({ source: 'colombia', id: hoveredStateId }, { hover: false });
            }
            hoveredStateId = null;
        });

        // --- 4. Dashboard Trigger (Click) ---
        map.on('click', 'colombia-fill', (e) => {
            if (!e.features[0]) return;

            const props = e.features[0].properties;
            const deptoName = props.NOMBRE_DPT; // e.g. "ANTIOQUIA"

            // Fly to the clicked coordinate artificially (or centroid if we had it)
            map.flyTo({
                center: [e.lngLat.lng, e.lngLat.lat],
                zoom: 7.5,
                pitch: 45,
                duration: 2500,
                essential: true
            });

            // Open Dashboard and fetch data
            openDashboardPanel(deptoName);
        });
    });

    // Close Panel Handler
    closeBtn.addEventListener('click', () => {
        sidePanel.classList.add('hidden');
        heroOverlay.style.opacity = '1';

        // Fly back to national view naturally
        map.flyTo({
            center: [-74.2973, 4.5709],
            zoom: 4.8,
            pitch: 0,
            bearing: 0,
            duration: 2500
        });
    });

    // --- 5. SODA API Integration (SECOP II) ---
    window.openDashboardPanel = async function (departamentoName) {
        // Hide Hero, Show Sidebar
        heroOverlay.style.opacity = '0';
        sidePanel.classList.remove('hidden');

        // Reset UI to loading state
        panelContent.classList.add('hidden');
        loadingSpinner.classList.add('active');

        // Fix string format for API (SODA usually stores them Title Cased or specific format depending on dataset)
        // We will fetch and log first to ensure it matches
        titleEl.textContent = departamentoName;

        try {
            // Target SECOP II API (We use 'departamento_ejecucion' or similar. 
            // We group by 'tipo_de_contrato' and sum 'valor_del_contrato' to generate a chart.)
            // Endpoint: https://www.datos.gov.co/resource/jbjy-vk9h.json

            // SODA SoQL Query:
            // Select: tipo_de_contrato, count(*), sum(valor_del_contrato)
            // Where: departamento = '...' AND year = 2024 (optional)
            // Group by: tipo_de_contrato

            // Normalize Name (e.g. ANTIOQUIA -> Antioquia) to match standard Socrata outputs, 
            // although some Datasets have it fully capitalized.
            const searchName = departamentoName === 'BOGOTÁ, D.C.' || departamentoName === 'SANTAFE DE BOGOTA D.C'
                ? 'Bogotá D.C.' :
                departamentoName.charAt(0) + departamentoName.slice(1).toLowerCase();

            const baseUrl = `https://www.datos.gov.co/resource/jbjy-vk9h.json`;
            const query = `?$select=tipo_de_contrato, count(id_contrato) as cantidad, sum(valor_del_contrato) as valor_total&$where=departamento='${searchName}'&$group=tipo_de_contrato&$order=valor_total DESC&$limit=10`;

            console.log(`Fetching SECOP II Data for: ${searchName}...`, baseUrl + query);

            const response = await fetch(baseUrl + query);
            const data = await response.json();

            console.log("SECOP API Response:", data);

            // Render the UI
            renderDashboardCards(data);

        } catch (error) {
            console.error("Error fetching SODA API:", error);
            titleEl.textContent = "Error al cargar datos";
            loadingSpinner.classList.remove('active');
        }
    };

    function renderDashboardCards(data) {
        // Toggle UI
        loadingSpinner.classList.remove('active');
        panelContent.classList.remove('hidden');

        if (!data || data.length === 0) {
            countEl.textContent = "0";
            totalEl.textContent = "$0";
            return;
        }

        // Calculate Totals
        let totalContracts = 0;
        let totalValue = 0;
        const chartLabels = [];
        const chartValues = [];

        data.forEach(row => {
            const count = parseInt(row.cantidad) || 0;
            const val = parseFloat(row.valor_total) || 0;
            totalContracts += count;
            totalValue += val;

            chartLabels.push(row.tipo_de_contrato || 'Desconocido');
            chartValues.push(val);
        });

        // Format numbers for UI
        countEl.textContent = new Intl.NumberFormat('es-CO').format(totalContracts);
        totalEl.textContent = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalValue);

        // Render Chart.js
        renderChart(chartLabels, chartValues);
    }

    // Common Chart.js Options reused from MVP
    const commonChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right',
                labels: { color: '#f8fafc', font: { family: 'Inter', size: 11 } }
            },
            tooltip: {
                backgroundColor: 'rgba(30, 41, 59, 0.95)',
                titleFont: { family: 'Outfit', size: 14 },
                bodyFont: { family: 'Inter', size: 13 },
                callbacks: {
                    label: function (context) {
                        let label = context.label || '';
                        if (label) { label += ': '; }
                        if (context.parsed !== null) {
                            label += new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(context.parsed);
                        }
                        return label;
                    }
                }
            }
        }
    };

    function renderChart(labels, dataArray) {
        if (myChart) {
            myChart.destroy();
        }

        myChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataArray,
                    backgroundColor: [
                        'rgba(56, 189, 248, 0.9)', // Light Blue
                        'rgba(192, 132, 252, 0.9)', // Purple
                        'rgba(16, 185, 129, 0.9)', // Emerald
                        'rgba(244, 63, 94, 0.9)', // Rose
                        'rgba(250, 204, 21, 0.9)', // Yellow
                        'rgba(148, 163, 184, 0.9)' // Slate
                    ],
                    borderWidth: 2,
                    borderColor: '#0b0f19'
                }]
            },
            options: {
                ...commonChartOptions,
                cutout: '70%',
                animation: { animateScale: true, animateRotate: true, duration: 1500, easing: 'easeOutQuart' }
            }
        });
    }

});
