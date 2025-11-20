// ZMIENNE GLOBALNE
let pdfFiles = []; 
const fileListEl = document.getElementById('file-list');
const mergeBtn = document.getElementById('mergeBtn');
const resetBtn = document.getElementById('resetBtn'); 
const sortControls = document.getElementById('sortControls');
const optionsWrapper = document.getElementById('optionsWrapper'); // Kontener checkboxa
const chaptersOpt = document.getElementById('chaptersOpt'); // Sam checkbox
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('fileInput');

// --- OBSŁUGA PLIKÓW PDF ---

fileInput.addEventListener('change', function(e) {
    const newFiles = Array.from(e.target.files);
    if (newFiles.length === 0) return;

    const startIndex = pdfFiles.length;
    newFiles.forEach((file, index) => {
        pdfFiles.push({
            file: file,
            id: Date.now() + index,
            originalIndex: startIndex + index
        });
    });

    renderList();
    this.value = null;
});

function renderList() {
    fileListEl.innerHTML = '';
    
    if (pdfFiles.length > 0) {
        sortControls.style.display = 'flex';
        optionsWrapper.style.display = 'flex'; // Pokaż opcje
        mergeBtn.disabled = false;
        resetBtn.style.display = 'block'; 
    } else {
        sortControls.style.display = 'none';
        optionsWrapper.style.display = 'none'; // Ukryj opcje
        mergeBtn.disabled = true;
        resetBtn.style.display = 'none'; 
    }

    pdfFiles.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'file-item';
        const fileSize = (item.file.size / 1024 / 1024).toFixed(2) + ' MB';

        li.innerHTML = `
            <div>
                <span class="file-info">${index + 1}. ${item.file.name}</span>
                <span class="file-size">(${fileSize})</span>
            </div>
            <div class="item-controls">
                <button onclick="moveItem(${index}, -1)" title="W górę" ${index === 0 ? 'disabled' : ''}>▲</button>
                <button onclick="moveItem(${index}, 1)" title="W dół" ${index === pdfFiles.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="remove-btn" onclick="removeItem(${index})" title="Usuń">✕</button>
            </div>
        `;
        fileListEl.appendChild(li);
    });
}

window.resetApp = function() {
    pdfFiles = [];
    renderList();
    statusEl.innerText = '';
    fileInput.value = null;
    chaptersOpt.checked = false; // Reset checkboxa
};

window.moveItem = function(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= pdfFiles.length) return;
    [pdfFiles[index], pdfFiles[targetIndex]] = [pdfFiles[targetIndex], pdfFiles[index]];
    renderList();
};

window.removeItem = function(index) {
    pdfFiles.splice(index, 1);
    renderList();
};

window.sortFiles = function(type) {
    if (type === 'alpha') {
        pdfFiles.sort((a, b) => a.file.name.localeCompare(b.file.name));
    } else if (type === 'upload') {
        pdfFiles.sort((a, b) => a.originalIndex - b.originalIndex);
    }
    renderList();
};

window.mergePDFs = async function() {
    if (pdfFiles.length === 0) return;
    try {
        statusEl.innerHTML = '<span class="loader"></span> Przetwarzanie...';
        mergeBtn.disabled = true;
        resetBtn.disabled = true;

        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();
        
        // Tablica do przechowywania informacji o rozdziałach
        // { title: "nazwa pliku", pageRef: PDFRef }
        const chapters = []; 

        for (const item of pdfFiles) {
            const arrayBuffer = await item.file.arrayBuffer();
            const pdf = await PDFDocument.load(arrayBuffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            
            // Czy dodajemy ten plik jako rozdział?
            if (chaptersOpt.checked && copiedPages.length > 0) {
                // Dodajemy stronę do dokumentu i zapisujemy REFERENCJĘ do pierwszej strony tego pliku
                const firstPage = mergedPdf.addPage(copiedPages[0]);
                chapters.push({
                    title: item.file.name.replace('.pdf', ''), // Usuwamy rozszerzenie dla ładniejszego wyglądu
                    pageRef: firstPage.ref
                });

                // Dodajemy resztę stron
                for (let i = 1; i < copiedPages.length; i++) {
                    mergedPdf.addPage(copiedPages[i]);
                }
            } else {
                // Standardowe dodawanie bez rozdziałów
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            }
        }

        // Jeśli opcja zaznaczona i mamy rozdziały, generujemy strukturę Outline
        if (chaptersOpt.checked && chapters.length > 0) {
            await createOutlines(mergedPdf, chapters);
        }

        const pdfBytes = await mergedPdf.save();
        download(pdfBytes, "polaczony_dokument.pdf", "application/pdf");
        
        statusEl.innerText = 'Sukces! Plik pobrany.';
        statusEl.style.color = 'var(--text-main)';

    } catch (err) {
        console.error(err);
        statusEl.innerText = 'Błąd: ' + err.message;
        statusEl.style.color = 'var(--danger)';
    } finally {
        mergeBtn.disabled = false;
        resetBtn.disabled = false;
    }
};

// --- POMOCNIK: TWORZENIE ZAKŁADEK (OUTLINES) W PDF-LIB ---
async function createOutlines(pdfDoc, chapters) {
    const { PDFName, PDFDict, PDFArray, PDFString } = PDFLib;

    // 1. Tworzymy obiekty Outline Item dla każdego rozdziału
    const outlineRefs = [];
    for (let i = 0; i < chapters.length; i++) {
        outlineRefs.push(pdfDoc.context.register(pdfDoc.context.obj({
            Title: PDFString.of(chapters[i].title),
            Parent: null, // Uzupełnimy później (Root)
            Prev: null,   // Uzupełnimy w pętli
            Next: null,   // Uzupełnimy w pętli
            Dest: [chapters[i].pageRef, PDFName.of('Fit')] // Link do strony
        })));
    }

    // 2. Tworzymy Root Outline (Katalog główny zakładek)
    const outlineRootRef = pdfDoc.context.register(pdfDoc.context.obj({
        Type: PDFName.of('Outlines'),
        First: outlineRefs[0],
        Last: outlineRefs[outlineRefs.length - 1],
        Count: chapters.length
    }));

    // 3. Linkujemy elementy ze sobą i z Rootem
    for (let i = 0; i < outlineRefs.length; i++) {
        const current = outlineRefs[i];
        const prev = i > 0 ? outlineRefs[i - 1] : null;
        const next = i < outlineRefs.length - 1 ? outlineRefs[i + 1] : null;

        // Ustawiamy Parent na Root
        pdfDoc.context.lookup(current).set(PDFName.of('Parent'), outlineRootRef);

        // Linkujemy Prev/Next
        if (prev) pdfDoc.context.lookup(current).set(PDFName.of('Prev'), prev);
        if (next) pdfDoc.context.lookup(current).set(PDFName.of('Next'), next);
    }

    // 4. Podpinamy Root Outline do Katalogu PDF
    pdfDoc.catalog.set(PDFName.of('Outlines'), outlineRootRef);
}

// --- OBSŁUGA DARK MODE / LIGHT MODE ---

const toggleBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const body = document.body;

function updateIcon() {
    const isLight = body.classList.contains('light-mode');
    themeIcon.textContent = isLight ? '🌑' : '☀️';
}

toggleBtn.addEventListener('click', () => {
    body.classList.toggle('light-mode');
    updateIcon();
});

// Start
updateIcon();