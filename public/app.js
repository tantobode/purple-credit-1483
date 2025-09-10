let html5QrcodeScanner;
let cart = [];
const FAKE_USER_ID = 'a79ac5419482cf6ab3d2591701b5b9e6';

document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (html5QrcodeScanner && html5QrcodeScanner.getState() === 2) {
                html5QrcodeScanner.clear().catch(err => console.error("Failed to clear scanner", err));
            }
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetContent = document.getElementById(tab.dataset.tab);
            if (targetContent) {
                targetContent.classList.add('active');
            }
            loadTabContent(tab.dataset.tab);
        });
    });

    document.getElementById('add-product-form')?.addEventListener('submit', handleAddProduct);
    document.getElementById('complete-sale-btn')?.addEventListener('click', handleCompleteSale);
    document.getElementById('add-expense-form')?.addEventListener('submit', handleRecordExpense);

    loadTabContent('sale');
});

function loadTabContent(tabId) {
    switch (tabId) {
        case 'sale': loadSalesTab(); break;
        case 'products': loadProductsTab(); break;
        case 'expenses': loadExpensesTab(); break;
        case 'reports': loadReportsTab(); break;
    }
}

// --- Sale Tab Logic ---
function loadSalesTab() {
    if (document.getElementById('reader') && !document.getElementById('reader').innerHTML) {
        const onScanSuccess = async (decodedText) => {
            document.getElementById('scanned-result').innerText = `Scanned: ${decodedText}`;
            try {
                const response = await fetch(`/api/products/barcode/${decodedText}`);
                if (!response.ok) {
                    if (response.status === 404) alert('Product not found!');
                    else throw new Error('Failed to fetch product by barcode');
                    return;
                }
                const product = await response.json();
                addToCart(product);
            } catch (error) { console.error(error); alert(error.message); }
        };
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
        html5QrcodeScanner.render(onScanSuccess, () => {});
    }
    renderCart();
}

function addToCart(product) {
    const existingItem = cart.find(item => item.id === product.id);
    if (existingItem) existingItem.quantity++;
    else cart.push({ ...product, quantity: 1 });
    renderCart();
}

function renderCart() {
    const cartItemsElement = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    if (!cartItemsElement || !cartTotalElement) return;
    cartItemsElement.innerHTML = '';
    let total = 0;
    cart.forEach(item => {
        const li = document.createElement('li');
        li.textContent = `${item.name} x${item.quantity} - $${(item.price * item.quantity).toFixed(2)}`;
        cartItemsElement.appendChild(li);
        total += item.price * item.quantity;
    });
    cartTotalElement.textContent = total.toFixed(2);
}

async function handleCompleteSale() {
    if (cart.length === 0) return alert('Cart is empty!');
    const transactionData = {
        type: 'sale',
        amount: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
        description: cart.map(item => `${item.quantity}x ${item.name}`).join(', '),
        user_id: FAKE_USER_ID,
    };
    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transactionData),
        });
        if (!response.ok) throw new Error(await response.text());
        alert('Sale completed successfully!');
        cart = [];
        renderCart();
    } catch (error) { console.error(error); alert(error.message); }
}

// --- Products Tab Logic ---
async function loadProductsTab() {
    try {
        const response = await fetch('/api/products');
        if (!response.ok) throw new Error('Failed to fetch products');
        const products = await response.json();
        const tableBody = document.querySelector('#product-list-table tbody');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        products.forEach(product => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${product.name}</td>
                <td>${product.price.toFixed(2)}</td>
                <td>${product.stock}</td>
                <td>${product.barcode || ''}</td>
                <td><button>Edit</button> <button>Delete</button></td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) { console.error(error); alert(error.message); }
}

async function handleAddProduct(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const productData = {
        name: formData.get('name'),
        price: parseFloat(formData.get('price')),
        stock: parseInt(formData.get('stock'), 10),
        barcode: formData.get('barcode') || null,
    };
    try {
        const response = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData),
        });
        if (!response.ok) throw new Error(await response.text());
        form.reset();
        loadProductsTab();
    } catch (error) { console.error(error); alert(error.message); }
}

// --- Expenses Tab Logic ---
function loadExpensesTab() { console.log('Loading expenses tab...'); }

async function handleRecordExpense(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const expenseData = {
        type: 'expense',
        description: formData.get('description'),
        amount: parseFloat(formData.get('amount')),
        user_id: FAKE_USER_ID,
    };
    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expenseData),
        });
        if (!response.ok) throw new Error(await response.text());
        alert('Expense recorded successfully!');
        form.reset();
    } catch (error) { console.error(error); alert(error.message); }
}

// --- Reports Tab ---
async function loadReportsTab() {
    console.log('Loading reports tab...');
    try {
        const response = await fetch('/api/transactions');
        if (!response.ok) throw new Error('Failed to fetch transactions');
        const transactions = await response.json();

        let totalIncome = 0;
        let totalExpenses = 0;

        transactions.forEach(t => {
            if (t.type === 'sale') {
                totalIncome += t.amount;
            } else if (t.type === 'expense') {
                totalExpenses += t.amount;
            }
        });

        const netProfit = totalIncome - totalExpenses;

        document.getElementById('total-income').textContent = totalIncome.toFixed(2);
        document.getElementById('total-expenses').textContent = totalExpenses.toFixed(2);
        document.getElementById('net-profit').textContent = netProfit.toFixed(2);

    } catch (error) {
        console.error('Error loading reports:', error);
        alert(error.message);
    }
}
