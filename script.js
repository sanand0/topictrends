import { csvParse } from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";

const marked = new Marked();
const demos = document.querySelector("#demos");
const results = document.querySelector("#results");
const statusContainer = document.getElementById("status-container");
const chartContainer = document.getElementById("chart-container");

let config;
let currentDemo = null;
let currentData = null;
let currentTopics = null;
let currentSimilarity = null;
let similarityCutoff = 0.3;
let currentYears = [];
let currentChartData = null;

const loading = /* html */ `
  <div class="d-flex justify-content-center align-items-center">
    <div class="spinner-border" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
  </div>
`;

async function init() {
  // Load demo options
  demos.innerHTML = loading;
  config = await fetch("config.json").then((res) => res.json());
  demos.innerHTML = config.demos
    .map(
      (demo, index) => /* html */ `
      <div class="col">
        <div class="card h-100 shadow-sm" data-index="${index}">
          <div class="card-body text-center">
            <iconify-icon icon="${demo.icon}" width="48" height="48" class="mb-3"></iconify-icon>
            <h5 class="card-title">${demo.name}</h5>
          </div>
          <div class="card-footer bg-transparent border-top-0">
            <button class="btn btn-primary w-100 select-demo" data-file="${demo.file}">Explore</button>
          </div>
        </div>
      </div>
    `
    )
    .join("");
}

demos.addEventListener("click", (e) => {
  const demo = e.target.closest(".select-demo");
  if (demo) {
    const demoIndex = parseInt(demo.closest(".card").dataset.index);
    currentDemo = config.demos[demoIndex];
    loadDemo(demo.dataset.file, demoIndex);
    chartContainer.classList.add("d-none");

    // Clear interpretation when a new demo is selected
    document.getElementById("interpretation").classList.add("d-none");
    document.getElementById("interpretation-content").innerHTML = "";
  }
});

/**
 * Loads and processes a demo CSV file
 * @param {string} file - CSV file name
 * @param {number} demoIndex - Index of the demo in config
 */
async function loadDemo(file, demoIndex) {
  // Clear previous content and show loading indicator
  results.innerHTML = loading;

  try {
    // Fetch CSV data
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);

    const csvText = await response.text();
    const parsedData = csvParse(csvText);

    // Process data - extract year from update_date and add as a field
    currentData = parsedData.map((d) => ({
      ...d,
      year: d.update_date.substring(0, 4),
    }));

    // Get year range
    const years = currentData.map((d) => d.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);

    // Get topics from config
    currentTopics = config.demos[demoIndex].topics || [];

    // Create UI for the demo
    createDemoUI(currentData, minYear, maxYear, currentTopics);
  } catch (error) {
    showError(`Error loading demo: ${error.message}`);
  }
}

/**
 * Creates the UI for the demo
 * @param {Array} data - Processed CSV data
 * @param {string} minYear - Minimum year in the dataset
 * @param {string} maxYear - Maximum year in the dataset
 * @param {Array} topics - List of topics for the demo
 */
function createDemoUI(data, minYear, maxYear, topics) {
  results.innerHTML = /* html */ `
    <div class="col-12 mb-4">
      <div class="card shadow-sm">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h3>${currentDemo.name}</h3>
          </div>

          <div class="alert alert-info">
            <strong>Dataset Info:</strong> ${data.length} documents from ${minYear} to ${maxYear}
          </div>

          <div class="mb-3">
            <label for="topics-textarea" class="form-label">Topics (one per line):</label>
            <textarea class="form-control" id="topics-textarea" rows="7">${topics.join("\n")}</textarea>
            <div class="form-text">Edit topics as needed, then click Classify to analyze the data.</div>
          </div>

          <div class="d-grid gap-2 d-md-flex justify-content-md-start mb-4">
            <button class="btn btn-primary" id="classify-button">Classify</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("classify-button").addEventListener("click", () => {
    classifyDocuments();
  });

  document.getElementById("similarity-cutoff").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById("cutoff-value").textContent = `${(value * 100).toFixed(0)}%`;
    similarityCutoff = value;
    if (currentSimilarity) updateVisualization();
  });
}

/**
 * Classifies documents using the specified API
 */
async function classifyDocuments() {
  // Get topics from textarea
  const topicsTextarea = document.getElementById("topics-textarea");
  const topics = topicsTextarea.value.split("\n").filter((t) => t.trim());

  if (topics.length === 0) {
    showError("Please enter at least one topic");
    return;
  }

  currentTopics = topics;

  // Prepare documents (title + abstract)
  const docs = currentData.map((d) => `${d.title}\n${d.abstract}`);

  // Show loading with additional message
  statusContainer.innerHTML = /* html */ `
    <div class="alert alert-info">
      <div class="d-flex align-items-center">
        <div class="spinner-border spinner-border-sm me-3" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <div>
          <strong>Classifying documents...</strong><br>
          <small>This process may take 60-120 seconds when running for the first time.</small>
        </div>
      </div>
    </div>
  `;

  try {
    // Send request to API
    const response = await fetch("https://llmfoundry.straive.com/similarity", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", docs, topics, precision: 5 }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const result = await response.json();
    currentSimilarity = result.similarity;

    // Show chart container
    chartContainer.classList.remove("d-none");
    statusContainer.innerHTML = "";

    // Update visualization
    updateVisualization();
  } catch (error) {
    showError(`Classification error: ${error.message}`);
  }
}

/**
 * Updates the visualization based on current data and similarity cutoff
 */
function updateVisualization() {
  // Assign topics to documents based on similarity cutoff
  const docTopics = currentData.map((doc, i) => {
    const similarities = currentSimilarity[i];
    const maxIndex = similarities.indexOf(Math.max(...similarities));
    const maxValue = similarities[maxIndex];

    return {
      ...doc,
      topicIndex: maxValue >= similarityCutoff ? maxIndex : null,
      topicName: maxValue >= similarityCutoff ? currentTopics[maxIndex] : "Unclassified",
    };
  });

  // Group by year and topic
  const yearTopicCounts = {};
  const years = [...new Set(docTopics.map((d) => d.year))].sort();
  currentYears = years;

  // Initialize counts
  years.forEach((year) => {
    yearTopicCounts[year] = {};
    currentTopics.forEach((topic, i) => {
      yearTopicCounts[year][topic] = 0;
    });
    yearTopicCounts[year]["Unclassified"] = 0;
  });

  // Count documents by year and topic
  docTopics.forEach((doc) => {
    yearTopicCounts[doc.year][doc.topicName]++;
  });

  // Prepare data for D3
  const chartData = currentTopics.map((topic, i) => ({
    topic,
    values: years.map((year) => ({
      year,
      count: yearTopicCounts[year][topic],
      docs: docTopics.filter((d) => d.year === year && d.topicName === topic),
      topic,
    })),
  }));

  // Filter out unclassified documents from the chart data
  // We don't need to add an 'Unclassified' category

  // Save chart data for interpretation
  currentChartData = chartData;

  // Draw chart
  drawChart(chartData, years);

  // Set default interpretation prompt
  const promptTextarea = document.getElementById("interpretation-prompt");
  promptTextarea.value = `Here is the trend of topics from arXiv papers for in the ${currentDemo.name} category over time. Interpret the trend. Explain what topics rising, falling, etc. Based on this recommend actions for publishers, researchers, and policymakers. Use concise, simple, language.`;
}

/**
 * Draws a line chart showing topic trends over time
 * @param {Array} data - Prepared data for visualization
 * @param {Array} years - List of years for x-axis
 */
function drawChart(data, years) {
  const chartElement = document.getElementById("chart");
  chartElement.innerHTML = "";

  // Set dimensions and margins
  const margin = { top: 40, right: 300, bottom: 60, left: 60 };
  const width = chartElement.clientWidth - margin.left - margin.right;
  const height = chartElement.clientHeight - margin.top - margin.bottom;

  // Create SVG
  const svg = d3
    .select("#chart")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
    .classed("img-fluid", true)
    .classed("w-100", true)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Add title
  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", -margin.top / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .style("fill", "currentColor")
    .text("Topic Trends Over Time");

  // Create scales
  const xScale = d3.scalePoint().domain(years).range([0, width]);

  const yScale = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d3.max(d.values, (v) => v.count)) * 1.1])
    .range([height, 0]);

  // Color scale
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

  // Add X axis
  svg
    .append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(xScale))
    .selectAll("text")
    .style("text-anchor", "middle");

  // Add X axis label
  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 10)
    .attr("text-anchor", "middle")
    .style("fill", "currentColor")
    .text("Year");

  // Add Y axis
  svg.append("g").call(d3.axisLeft(yScale));

  // Add Y axis label
  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15)
    .attr("x", -height / 2)
    .attr("text-anchor", "middle")
    .style("fill", "currentColor")
    .text("Number of Documents");

  // Add grid lines
  svg
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(yScale).tickSize(-width).tickFormat(""))
    .selectAll("line")
    .style("stroke", "#e0e0e0")
    .style("stroke-opacity", 0.7);

  // Create line generator
  const line = d3
    .line()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.count))
    .curve(d3.curveMonotoneX);

  // Create tooltip
  const tooltip = d3
    .select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("background", "var(--bs-body-bg)")
    .style("border", "1px solid #ddd")
    .style("border-radius", "4px")
    .style("padding", "10px")
    .style("box-shadow", "0 2px 5px rgba(0,0,0,0.2)")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("z-index", 1000);

  // Add lines for each topic
  const topics = data.map((d) => d.topic);
  const topicVisibility = {};
  topics.forEach((topic) => (topicVisibility[topic] = true));

  const lines = svg.selectAll(".line-group").data(data).enter().append("g").attr("class", "line-group");

  lines
    .append("path")
    .attr("class", "line")
    .attr("d", (d) => line(d.values))
    .style("stroke", (d) => colorScale(d.topic))
    .style("stroke-width", 2.5)
    .style("fill", "none")
    .style("opacity", 1);

  // Add circles at each data point
  lines
    .selectAll("circle")
    .data((d) => d.values)
    .enter()
    .append("circle")
    .attr("cx", (d) => xScale(d.year))
    .attr("cy", (d) => yScale(d.count))
    .attr("r", 5)
    .style("fill", (d) => colorScale(d.year))
    .style("stroke", "white")
    .style("stroke-width", 1.5)
    .on("mouseover", function (event, d) {
      d3.select(this).transition().duration(100).attr("r", 8);

      if (d.docs.length > 0) {
        tooltip.transition().duration(100).style("opacity", 0.9);

        const doc = d.docs[0]; // Show first document as an example
        tooltip
          .html(
            `
          <strong>${d.count} documents in ${d.topic} in ${d.year}</strong><br/>
          <strong>Example:</strong> ${doc.title}<br/>
          <small>${doc.abstract.substring(0, 100)}...</small>
        `
          )
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY - 28 + "px");
      }
    })
    .on("mouseout", function () {
      d3.select(this).transition().duration(100).attr("r", 5);
      tooltip.transition().duration(200).style("opacity", 0);
    })
    .on("click", function (event, d) {
      event.stopPropagation();

      if (d.docs.length > 0) showDocumentsModal(d.topic, d.year, d.docs);
    });

  /**
   * Shows a modal with documents for a specific topic and year
   * @param {string} topic - Topic name
   * @param {string} year - Year
   * @param {Array} docs - Documents to display
   */
  function showDocumentsModal(topic, year, docs) {
    const modalTitle = document.getElementById("document-modal-label");
    const modalContent = document.getElementById("document-modal-content");

    modalTitle.textContent = `${topic} (${year}) - ${docs.length} documents`;

    // Create document list
    const docList = docs
      .map(
        (doc, index) => /* html */ `
      <div class="card mb-2">
        <div class="card-body py-2 px-3">
          <div class="d-flex">
            <div class="me-3 text-muted">${index + 1}.</div>
            <div>
              <a href="https://arxiv.org/abs/${doc.id}" target="_blank" class="text-decoration-none">
                ${doc.title}
              </a>
              <p class="text-muted small mb-0 mt-1">${doc.abstract.substring(0, 100)}...</p>
            </div>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    modalContent.innerHTML = docList;

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById("document-modal"));
    modal.show();
  }

  // Add legend
  const legend = svg
    .append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${width + 20}, 0)`);

  const legendItems = legend
    .selectAll(".legend-item")
    .data(data)
    .enter()
    .append("g")
    .attr("class", "legend-item")
    .attr("transform", (d, i) => `translate(0, ${i * 25})`)
    .style("cursor", "pointer")
    .on("click", function (event, d) {
      event.stopPropagation();
      const topic = d.topic;
      topicVisibility[topic] = !topicVisibility[topic];

      // Update opacity of the line
      svg
        .selectAll(".line-group")
        .filter((line) => line.topic === topic)
        .selectAll("path, circle")
        .transition()
        .duration(300)
        .style("opacity", topicVisibility[topic] ? 1 : 0.1);

      // Update legend item opacity
      d3.select(this)
        .transition()
        .duration(300)
        .style("opacity", topicVisibility[topic] ? 1 : 0.5);
    });

  legendItems
    .append("rect")
    .attr("width", 18)
    .attr("height", 18)
    .style("fill", (d) => colorScale(d.topic));

  legendItems
    .append("text")
    .attr("x", 24)
    .attr("y", 9)
    .attr("dy", ".35em")
    .attr("fill", "currentColor")
    .text((d) => d.topic)
    .style("font-size", "12px");
}

/**
 * Shows an error message to the user
 * @param {string} message - Error message to display
 */
function showError(message) {
  const statusContainer = document.getElementById("status-container");
  statusContainer.innerHTML = /* html */ `
    <div class="alert alert-danger" role="alert">
      <strong>Error:</strong> ${message}
    </div>
  `;
}

// Add event listener for the interpret button
document.getElementById("interpret-button")?.addEventListener("click", interpretTrends);

/**
 * Interprets the current trend data using an LLM
 */
async function interpretTrends() {
  if (!currentChartData || currentChartData.length === 0) {
    showError("No trend data available to interpret");
    return;
  }

  // Get the prompt from the textarea
  const promptTextarea = document.getElementById("interpretation-prompt");
  const systemPrompt = promptTextarea.value.trim();

  if (!systemPrompt) {
    showError("Please enter a prompt for interpretation");
    return;
  }

  // Create text representation of the trend data
  const trendText = createTrendText(currentChartData, currentYears);

  // Show the interpretation section and set loading state
  const interpretationDiv = document.getElementById("interpretation");
  const interpretationContent = document.getElementById("interpretation-content");
  interpretationDiv.classList.remove("d-none");
  interpretationContent.innerHTML = `<div class="d-flex align-items-center">
    <div class="spinner-border spinner-border-sm me-2" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
    <span>Generating interpretation...</span>
  </div>`;

  try {
    // Call the LLM API
    for await (const { content } of asyncLLM("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trendText },
        ],
      }),
    })) {
      if (content) interpretationContent.innerHTML = marked.parse(content);
    }
  } catch (error) {
    interpretationContent.innerHTML = `<div class="alert alert-danger">
      <strong>Error:</strong> Failed to generate interpretation: ${error.message}
    </div>`;
  }
}

/**
 * Creates a text representation of the trend data
 * @param {Array} chartData - Chart data with topic trends
 * @param {Array} years - Array of years
 * @returns {string} - Text representation of trends
 */
function createTrendText(chartData, years) {
  if (!chartData || chartData.length === 0 || !years || years.length === 0) {
    return "No trend data available";
  }

  let text = `Topic trends from ${years[0]} to ${years[years.length - 1]}\n\n`;

  chartData.forEach((topicData) => {
    const values = topicData.values.map((v) => v.count);
    text += `${topicData.topic}: ${values.join(", ")}\n`;
  });

  return text;
}

init();
