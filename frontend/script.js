"use strict";

// ============================================
// DOM ELEMENTS
// ============================================

const ediInput = document.getElementById("ediInput");
const processBtn = document.getElementById("processBtn");
const statusMessage = document.getElementById("statusMessage");

const recordSeparator = document.getElementById("recordSeparator");
const fieldSeparator = document.getElementById("fieldSeparator");
const customRecordSeparator = document.getElementById("customRecordSeparator");
const customFieldSeparator = document.getElementById("customFieldSeparator");

const resultTable = document.getElementById("resultTable");
const tableHead = resultTable.querySelector("thead");
const tableBody = resultTable.querySelector("tbody");

const summary = document.getElementById("summary");
const errorsList = document.getElementById("errorsList");
const warningsList = document.getElementById("warningsList");

const cellAddress = document.getElementById("cellAddress");
const formulaInput = document.getElementById("formulaInput");
const selectionInfo = document.getElementById("selectionInfo");
const rowCount = document.getElementById("rowCount");
const zoomLabel = document.getElementById("zoomLabel");

const sequenceList = document.getElementById("sequenceList");
const newSequenceType = document.getElementById("newSequenceType");
const addSequenceBtn = document.getElementById("addSequenceBtn");
const applySequenceBtn = document.getElementById("applySequenceBtn");
const resetSequenceBtn = document.getElementById("resetSequenceBtn");
const sequenceStatus = document.getElementById("sequenceStatus");

// ============================================
// APPLICATION STATE
// ============================================

let currentColumns = [];
let currentRows = [];

let originalColumns = [];
let originalRows = [];

let zoomLevel = 1;
let wrapEnabled = false;
let selectedCell = null;
let columnWidths = {};

// Selected filter values, indexed by column number.
let columnFilters = {};

const DEFAULT_SEQUENCE = [
    "EE RECORD",
    "DEPENDENT RECORD",
    "18*",
    "01*",
    "19*",
    "53*",
    "N*",
    "REF",
    "NM1",
    "PER",
    "N3",
    "N4",
    "DMG",
    "HD",
    "DTP",
    "REF"
];

let sequenceTypes = [...DEFAULT_SEQUENCE];

// ============================================
// EXCEL COLUMN NAME
// ============================================

function excelColumnName(index) {
    let result = "";
    let number = index + 1;

    while (number > 0) {
        const remainder = (number - 1) % 26;

        result =
            String.fromCharCode(65 + remainder) + result;

        number = Math.floor((number - 1) / 26);
    }

    return result;
}

// ============================================
// COLUMN FILTER STYLES
// ============================================

(function addColumnFilterStyles() {
    if (document.getElementById("columnFilterStyles")) return;

    const style = document.createElement("style");
    style.id = "columnFilterStyles";

    style.textContent = `
        #resultTable th.filterable-header {
            min-width: 145px;
            padding: 4px;
            vertical-align: top;
        }

        #resultTable .column-header-content {
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 0;
        }

        #resultTable .column-header-label {
            text-align: center;
            font-weight: 600;
        }

        #resultTable select.column-filter {
            display: block;
            width: 100%;
            min-width: 0;
            height: 25px;
            padding: 2px 4px;
            border: 1px solid #c8cec8;
            border-radius: 3px;
            background: #fff;
            color: #202124;
            font-size: 11px;
            cursor: pointer;
        }

        #resultTable select.column-filter:focus {
            outline: 2px solid #217346;
            outline-offset: -1px;
        }

        #resultTable th.filterable-header {
            position: relative;
        }

        #resultTable .column-filter {
            position: relative;
            z-index: 2;
        }
    `;

    document.head.appendChild(style);
})();

// ============================================
// DYNAMIC COLUMN FILTERS
// ============================================

function getColumnFilterValue(columnIndex) {
    return columnFilters[columnIndex] ?? "";
}

function createColumnFilter(column, columnIndex) {
    const filter = document.createElement("select");

    filter.className = "column-filter";
    filter.title = `Filter column ${excelColumnName(columnIndex)}`;
    filter.setAttribute(
        "aria-label",
        `Filter column ${excelColumnName(columnIndex)}`
    );

    const allOption = document.createElement("option");

    allOption.value = "";
    allOption.textContent = "All";

    filter.appendChild(allOption);

    // Get unique values from the current column.
    const uniqueValues = [
        ...new Set(
            currentRows.map(row => String(row[column] ?? ""))
        )
    ].sort((a, b) => a.localeCompare(b));

    uniqueValues.forEach(value => {
        const option = document.createElement("option");

        option.value = value;
        option.textContent = value === "" ? "(Blank)" : value;

        filter.appendChild(option);
    });

    filter.value = getColumnFilterValue(columnIndex);

    // Clear a saved filter if its value no longer exists.
    if (
        ![...filter.options].some(
            option => option.value === filter.value
        )
    ) {
        filter.value = "";
        delete columnFilters[columnIndex];
    }

    filter.addEventListener("change", () => {
        if (filter.value === "") {
            delete columnFilters[columnIndex];
        } else {
            columnFilters[columnIndex] = filter.value;
        }

        applyColumnFilters();
    });

    return filter;
}

function applyColumnFilters() {
    const rows = tableBody.querySelectorAll("tr");

    rows.forEach((tr, rowIndex) => {
        const row = currentRows[rowIndex];

        if (!row) {
            tr.style.display = "none";
            return;
        }

        // Every selected filter must match.
        const matches = currentColumns.every(
            (column, columnIndex) => {
                const selectedValue =
                    getColumnFilterValue(columnIndex);

                if (selectedValue === "") {
                    return true;
                }

                return String(row[column] ?? "") === selectedValue;
            }
        );

        tr.style.display = matches ? "" : "none";
    });

    const visibleCount = [...rows].filter(
        tr => tr.style.display !== "none"
    ).length;

    rowCount.textContent =
        `${visibleCount} of ${currentRows.length} rows`;
}

// ============================================
// PROCESS EDI DATA
// ============================================

processBtn.addEventListener("click", processData);

async function processData() {
    const data = ediInput.value.trim();

    if (!data) {
        statusMessage.textContent =
            "Please paste EDI data first.";
        return;
    }

    processBtn.disabled = true;
    statusMessage.textContent = "Processing data...";

    try {
        const response = await fetch("/api/process", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                data,
                record_separator: recordSeparator.value,
                field_separator: fieldSeparator.value,
                custom_record_separator: customRecordSeparator.value,
                custom_field_separator: customFieldSeparator.value
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.detail || "Unable to process EDI data."
            );
        }

        if (!Array.isArray(result.columns)) {
            throw new Error(
                "Invalid API response: columns must be an array."
            );
        }

        if (!Array.isArray(result.rows)) {
            throw new Error(
                "Invalid API response: rows must be an array."
            );
        }

        originalColumns = [...result.columns];

        originalRows = result.rows.map(row => ({
            ...row
        }));

        currentColumns = [...originalColumns];

        currentRows = originalRows.map(row => ({
            ...row
        }));

        columnWidths = {};
        columnFilters = {};
        selectedCell = null;

        renderTable();
        renderMessages(result);

        summary.textContent =
            `Records: ${result.record_count ?? currentRows.length}` +
            ` | Employees: ${result.employee_count ?? 0}` +
            ` | Dependents: ${result.dependent_count ?? 0}`;

        rowCount.textContent = `${currentRows.length} rows`;

        selectionInfo.textContent =
            `${currentRows.length} rows × ${currentColumns.length} columns`;

        statusMessage.textContent = "Data loaded successfully.";

        sequenceStatus.textContent =
            "Data loaded. You can now apply a column sequence.";

    } catch (error) {
        console.error("EDI processing error:", error);

        statusMessage.textContent =
            error.message || "An unexpected error occurred.";

    } finally {
        processBtn.disabled = false;
    }
}

// ============================================
// RENDER TABLE WITH FILTERS
// ============================================

function renderTable() {
    tableHead.replaceChildren();
    tableBody.replaceChildren();

    formulaInput.value = "";
    cellAddress.value = "";

    const headerRow = document.createElement("tr");

    const corner = document.createElement("th");
    corner.className = "row-number";
    corner.textContent = "";

    headerRow.appendChild(corner);

    // Create a header and filter for every column.
    currentColumns.forEach((column, columnIndex) => {
        const th = document.createElement("th");
        const columnName = excelColumnName(columnIndex);

        th.title = `Column ${columnName}`;
        th.classList.add("filterable-header");

        const headerContent = document.createElement("div");
        headerContent.className = "column-header-content";

        const headerLabel = document.createElement("div");
        headerLabel.className = "column-header-label";
        headerLabel.textContent = columnName;

        const filter = createColumnFilter(column, columnIndex);

        const handle = document.createElement("div");
        handle.className = "resize-handle";

        handle.addEventListener("mousedown", event => {
            startResize(event, columnIndex);
        });

        headerContent.appendChild(headerLabel);
        headerContent.appendChild(filter);

        th.appendChild(headerContent);
        th.appendChild(handle);

        th.addEventListener("click", event => {
            if (event.target.closest(".column-filter")) {
                return;
            }

            selectionInfo.textContent =
                `Column ${columnName} selected`;
        });

        headerRow.appendChild(th);
    });

    tableHead.appendChild(headerRow);

    // Render data rows.
    currentRows.forEach((row, rowIndex) => {
        const tr = document.createElement("tr");

        const numberCell = document.createElement("th");
        numberCell.className = "row-number";
        numberCell.textContent = rowIndex + 1;

        tr.appendChild(numberCell);

        currentColumns.forEach((column, columnIndex) => {
            const td = document.createElement("td");

            td.textContent = String(row[column] ?? "");
            td.dataset.row = rowIndex;
            td.dataset.column = columnIndex;

            td.addEventListener("click", () => {
                selectCell(rowIndex, columnIndex);
            });

            tr.appendChild(td);
        });

        tableBody.appendChild(tr);
    });

    applyColumnWidths();
    applyZoom();

    resultTable.classList.toggle("wrap-text", wrapEnabled);

    applyColumnFilters();

    if (currentRows.length && currentColumns.length) {
        selectCell(0, 0);
    } else {
        selectedCell = null;
        selectionInfo.textContent = "No data";
    }
}

// ============================================
// SELECT CELL
// ============================================

function selectCell(rowIndex, columnIndex) {
    resultTable
        .querySelectorAll(".selected-cell, .selected-column")
        .forEach(element => {
            element.classList.remove(
                "selected-cell",
                "selected-column"
            );
        });

    const cell = tableBody.querySelector(
        `td[data-row="${rowIndex}"][data-column="${columnIndex}"]`
    );

    const heading =
        tableHead.querySelectorAll("th")[columnIndex + 1];

    if (!cell) {
        return;
    }

    cell.classList.add("selected-cell");

    if (heading) {
        heading.classList.add("selected-column");
    }

    selectedCell = {
        rowIndex,
        columnIndex
    };

    const address =
        excelColumnName(columnIndex) + (rowIndex + 1);

    cellAddress.value = address;
    formulaInput.value = cell.textContent;

    selectionInfo.textContent = `Selected ${address}`;

    cell.scrollIntoView({
        block: "nearest",
        inline: "nearest"
    });
}

// ============================================
// RESIZE COLUMNS
// ============================================

function startResize(event, columnIndex) {
    event.preventDefault();
    event.stopPropagation();

    const th = event.currentTarget.parentElement;

    const startX = event.clientX;
    const startWidth = th.getBoundingClientRect().width;

    function onMouseMove(moveEvent) {
        const newWidth = Math.max(
            45,
            Math.min(
                600,
                startWidth + moveEvent.clientX - startX
            )
        );

        columnWidths[columnIndex] = newWidth;

        applyColumnWidths();
    }

    function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
}

// ============================================
// APPLY COLUMN WIDTHS
// ============================================

function applyColumnWidths() {
    const headerCells = tableHead.querySelectorAll("th");

    currentColumns.forEach((column, index) => {
        const width = columnWidths[index] || 145;
        const header = headerCells[index + 1];

        if (header) {
            header.style.width = `${width}px`;
            header.style.minWidth = `${width}px`;
            header.style.maxWidth = `${width}px`;
        }

        tableBody.querySelectorAll("tr").forEach(tr => {
            const cell = tr.children[index + 1];

            if (cell) {
                cell.style.width = `${width}px`;
                cell.style.minWidth = `${width}px`;
                cell.style.maxWidth = `${width}px`;
            }
        });
    });
}

// ============================================
// ERRORS AND WARNINGS
// ============================================

function renderMessages(result) {
    errorsList.replaceChildren();
    warningsList.replaceChildren();

    (result.errors || []).forEach(message => {
        const li = document.createElement("li");
        li.textContent = message;
        errorsList.appendChild(li);
    });

    (result.warnings || []).forEach(message => {
        const li = document.createElement("li");
        li.textContent = message;
        warningsList.appendChild(li);
    });
}

// ============================================
// AUTOFIT
// ============================================

document.getElementById("autoFitBtn").addEventListener("click", () => {
    currentColumns.forEach((column, columnIndex) => {
        let maxLength = excelColumnName(columnIndex).length;

        currentRows.forEach(row => {
            maxLength = Math.max(
                maxLength,
                String(row[column] ?? "").length
            );
        });

        columnWidths[columnIndex] = Math.max(
            70,
            Math.min(600, maxLength * 8 + 22)
        );
    });

    applyColumnWidths();
});

// ============================================
// RESET COLUMN WIDTHS
// ============================================

document.getElementById("resetWidthsBtn").addEventListener("click", () => {
    columnWidths = {};
    applyColumnWidths();
});

// ============================================
// WRAP TEXT
// ============================================

document.getElementById("wrapBtn").addEventListener("click", () => {
    wrapEnabled = !wrapEnabled;
    resultTable.classList.toggle("wrap-text", wrapEnabled);
});

// ============================================
// ZOOM
// ============================================

document.getElementById("zoomInBtn").addEventListener("click", () => {
    zoomLevel = Math.min(zoomLevel + 0.1, 2);
    applyZoom();
});

document.getElementById("zoomOutBtn").addEventListener("click", () => {
    zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
    applyZoom();
});

function applyZoom() {
    resultTable.style.fontSize = `${13 * zoomLevel}px`;
    zoomLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
}

// ============================================
// CLEAR DATA
// ============================================

document.getElementById("clearBtn").addEventListener("click", () => {
    currentColumns = [];
    currentRows = [];

    originalColumns = [];
    originalRows = [];

    columnWidths = {};
    columnFilters = {};
    selectedCell = null;

    tableHead.replaceChildren();
    tableBody.replaceChildren();

    summary.textContent = "No data loaded";
    rowCount.textContent = "0 rows";

    selectionInfo.textContent = "Ready";

    cellAddress.value = "";
    formulaInput.value = "";

    errorsList.replaceChildren();
    warningsList.replaceChildren();

    sequenceStatus.textContent =
        "Process EDI data before applying a sequence.";

    statusMessage.textContent = "Results cleared.";
});

// ============================================
// EXPORT TO EXCEL
// ============================================

document.getElementById("exportBtn").addEventListener("click", () => {
    if (!currentColumns.length || !currentRows.length) {
        statusMessage.textContent =
            "Process data before exporting.";
        return;
    }

    if (typeof XLSX === "undefined") {
        statusMessage.textContent =
            "Excel export library did not load. Check your internet connection.";
        return;
    }

    const exportData = [
        currentColumns.map((column, index) => excelColumnName(index)),

        ...currentRows.map(row =>
            currentColumns.map(column =>
                row[column] == null ? "" : String(row[column])
            )
        )
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(exportData);

    worksheet["!cols"] = currentColumns.map((column, index) => ({
        wch: Math.max(
            12,
            Math.min(60, (columnWidths[index] || 145) / 7)
        )
    }));

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "EDI Data"
    );

    XLSX.writeFile(workbook, "edi_mapped_data.xlsx");

    statusMessage.textContent = "Excel file downloaded.";
});

// ============================================
// DYNAMIC COLUMN SEQUENCE FILTER
// ============================================

function normalizeSequenceType(value) {
    return String(value ?? "").trim().toUpperCase();
}

// ============================================
// IDENTIFY SEGMENT TYPE
// ============================================

function getSegmentType(value) {
    const segment = normalizeSequenceType(value);

    if (!segment) return "";

    if (segment === "EE RECORD") return "EE RECORD";
    if (segment === "DEPENDENT RECORD") return "DEPENDENT RECORD";

    const exactTypes = [
        "NM1",
        "PER",
        "N3",
        "N4",
        "DMG",
        "HD",
        "DTP",
        "REF",
        "NM3",
        "DPT"
    ];

    for (const type of exactTypes) {
        if (segment === type || segment.startsWith(type + "*")) {
            return type;
        }
    }

    const wildcardTypes = [
        "18*",
        "01*",
        "19*",
        "53*",
        "N*"
    ];

    for (const type of wildcardTypes) {
        const prefix = type.slice(0, -1);

        if (segment.startsWith(prefix)) {
            return type;
        }
    }

    return segment.split("*")[0] || "UNKNOWN";
}

// ============================================
// MATCH SEGMENT TO CONFIGURED TYPE
// ============================================

function matchesSequenceType(segment, configuredType) {
    const value = normalizeSequenceType(segment);
    const type = normalizeSequenceType(configuredType);

    if (!value || !type) return false;

    if (
        type === "EE RECORD" ||
        type === "DEPENDENT RECORD"
    ) {
        return value === type;
    }

    if (type.endsWith("*")) {
        return value.startsWith(type.slice(0, -1));
    }

    return value === type || value.startsWith(type + "*");
}

// ============================================
// RENDER SEQUENCE CONFIGURATION
// ============================================

function renderSequenceList() {
    sequenceList.replaceChildren();

    sequenceTypes.forEach((type, index) => {
        const item = document.createElement("div");
        item.className = "sequence-item";

        const number = document.createElement("span");
        number.className = "sequence-number";
        number.textContent = index + 1;

        const name = document.createElement("span");
        name.className = "sequence-name";
        name.textContent = type;

        const upButton = document.createElement("button");
        upButton.type = "button";
        upButton.textContent = "↑";
        upButton.title = "Move up";
        upButton.disabled = index === 0;

        upButton.addEventListener("click", () => {
            if (index === 0) return;

            [
                sequenceTypes[index - 1],
                sequenceTypes[index]
            ] = [
                sequenceTypes[index],
                sequenceTypes[index - 1]
            ];

            renderSequenceList();

            sequenceStatus.textContent =
                "Order changed. Click Apply Sequence.";
        });

        const downButton = document.createElement("button");
        downButton.type = "button";
        downButton.textContent = "↓";
        downButton.title = "Move down";
        downButton.disabled = index === sequenceTypes.length - 1;

        downButton.addEventListener("click", () => {
            if (index >= sequenceTypes.length - 1) return;

            [
                sequenceTypes[index],
                sequenceTypes[index + 1]
            ] = [
                sequenceTypes[index + 1],
                sequenceTypes[index]
            ];

            renderSequenceList();

            sequenceStatus.textContent =
                "Order changed. Click Apply Sequence.";
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.className = "delete-sequence";

        deleteButton.addEventListener("click", () => {
            sequenceTypes.splice(index, 1);

            renderSequenceList();

            sequenceStatus.textContent =
                "Configuration updated. Click Apply Sequence.";
        });

        item.append(
            number,
            name,
            upButton,
            downButton,
            deleteButton
        );

        sequenceList.appendChild(item);
    });
}

// ============================================
// ADD NEW SEQUENCE TYPE
// ============================================

addSequenceBtn.addEventListener("click", () => {
    const value = normalizeSequenceType(newSequenceType.value);

    if (!value) {
        sequenceStatus.textContent = "Enter a record type first.";
        return;
    }

    sequenceTypes.push(value);
    newSequenceType.value = "";

    renderSequenceList();

    sequenceStatus.textContent =
        `${value} added. Click Apply Sequence.`;
});

newSequenceType.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        addSequenceBtn.click();
    }
});

// ============================================
// RESET DEFAULT SEQUENCE
// ============================================

resetSequenceBtn.addEventListener("click", () => {
    sequenceTypes = [...DEFAULT_SEQUENCE];

    renderSequenceList();

    sequenceStatus.textContent =
        "Default sequence restored. Click Apply Sequence.";
});

// ============================================
// APPLY SEQUENCE
// ============================================

applySequenceBtn.addEventListener("click", () => {
    if (!originalColumns.length || !originalRows.length) {
        sequenceStatus.textContent =
            "Process EDI data before applying the sequence.";
        return;
    }

    applyConfiguredSequence();
});

// ============================================
// APPLY CONFIGURED COLUMN SEQUENCE
// ============================================

function applyConfiguredSequence() {
    const configuredTypes = sequenceTypes
        .map(normalizeSequenceType)
        .filter(Boolean);

    if (!configuredTypes.length) {
        sequenceStatus.textContent = "Add at least one sequence type.";
        return;
    }

    // Always start with original mapped data.
    const rowSegments = originalRows.map(row =>
        originalColumns
            .map(column => String(row[column] ?? ""))
            .filter(value => value !== "")
    );

    const slots = configuredTypes.map((type, index) => ({
        type,
        key: `Sequence_${index + 1}`,
        index
    }));

    // Find how many extra columns each segment type needs.
    const overflowTypes = [];
    const maximumOverflow = new Map();

    rowSegments.forEach(segments => {
        const usedSlots = new Set();
        const overflowCount = new Map();

        segments.forEach(segment => {
            const type = getSegmentType(segment);

            const targetSlot = slots.find(slot =>
                !usedSlots.has(slot.key) &&
                matchesSequenceType(type, slot.type)
            );

            if (targetSlot) {
                usedSlots.add(targetSlot.key);
                return;
            }

            const occurrence = (overflowCount.get(type) || 0) + 1;
            overflowCount.set(type, occurrence);

            if (!overflowTypes.includes(type)) {
                overflowTypes.push(type);
            }

            maximumOverflow.set(
                type,
                Math.max(maximumOverflow.get(type) || 0, occurrence)
            );
        });
    });

    // Create overflow columns for repeated or unexpected segments.
    const overflowSlots = [];

    overflowTypes.forEach(type => {
        const maximum = maximumOverflow.get(type) || 0;

        for (let occurrence = 1; occurrence <= maximum; occurrence++) {
            overflowSlots.push({
                type,
                occurrence,
                key: `Extra_${overflowSlots.length + 1}`,
                index: slots.length + overflowSlots.length
            });
        }
    });

    const allSlots = [...slots, ...overflowSlots];
    const outputColumns = allSlots.map(slot => slot.key);

    // Populate each output row without intentionally dropping segments.
    const outputRows = rowSegments.map(segments => {
        const outputRow = {};

        outputColumns.forEach(column => {
            outputRow[column] = "";
        });

        const usedSlots = new Set();
        const overflowCount = new Map();

        segments.forEach(segment => {
            const type = getSegmentType(segment);

            let targetSlot = slots.find(slot =>
                !usedSlots.has(slot.key) &&
                matchesSequenceType(type, slot.type)
            );

            if (targetSlot) {
                outputRow[targetSlot.key] = segment;
                usedSlots.add(targetSlot.key);
                return;
            }

            const occurrence = (overflowCount.get(type) || 0) + 1;
            overflowCount.set(type, occurrence);

            targetSlot = overflowSlots.find(slot =>
                slot.type === type &&
                slot.occurrence === occurrence
            );

            if (targetSlot) {
                outputRow[targetSlot.key] = segment;
                usedSlots.add(targetSlot.key);
                return;
            }

            console.error("Unable to assign EDI segment:", segment);
        });

        return outputRow;
    });

    currentColumns = outputColumns;
    currentRows = outputRows;

    columnWidths = {};
    columnFilters = {};
    selectedCell = null;

    renderTable();

    rowCount.textContent = `${currentRows.length} rows`;

    selectionInfo.textContent =
        `${currentRows.length} rows × ${currentColumns.length} columns`;

    sequenceStatus.textContent =
        `Sequence applied successfully. ${currentColumns.length} columns generated.`;

    statusMessage.textContent = "Column sequence updated.";
}

// ============================================
// INITIALIZE SEQUENCE CONFIGURATION
// ============================================

renderSequenceList();