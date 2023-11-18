const encodeDetails = function (name, duration, minimalPrice, basePrice) {
    const details = JSON.stringify({ name, duration, minimalPrice, basePrice });
    return btoa(details); // Encoding to Base64
};

const decodeDetails = function (encodedDetails) {
    const decoded = atob(encodedDetails); // Decoding from Base64
    return JSON.parse(decoded);
};

(function () {

    function getUsername(msg) {
        let username = '';

        while (!username || username.trim() === '') {
            username = prompt(msg);
        }

        return username;
    }

    const socket = io('wss://wbauctions.centraldungeon.org');

    window.username = ''; // Store the registered username
    window.intervalId = null;
    const urlParams = new URLSearchParams(window.location.search);

    // Function to retrieve the stored cookie from localStorage
    function getStoredCookie() {
        return localStorage.getItem('userSession');
    }

    // Function to store the received cookie in localStorage
    function storeCookie(cookie) {
        localStorage.setItem('userSession', cookie);
    }

    socket.on('connect', () => {
        const storedCookie = getStoredCookie(); // Retrieve the stored cookie from local storage or other means

        if (!urlParams.has('id')) {
            socket.emit('checkAuth', storedCookie, urlParams.get('id'));
            const auctionModal = new bootstrap.Modal(document.getElementById('auctionModal'));
            auctionModal.show();

            document.getElementById('submitDetails').onclick = () => {
                const auctionName = document.getElementById('auctionName').value.trim();
                const auctionDuration = document.getElementById('auctionDuration').value;
                const auctionMinimalPrice = document.getElementById('auctionMinimalPrice').value;
                const auctionBasePrice = document.getElementById('auctionBasePrice').value;

                if (auctionName === '') {
                    alert('Por favor proporciona un nombre valido.');
                    return;
                }

                const encodedDetails = encodeDetails(auctionName, auctionDuration, auctionMinimalPrice, auctionBasePrice);
                window.location.href = `${window.location.origin}${window.location.pathname}?id=${encodedDetails}`;
            };
        } else {
            socket.emit('auth', storedCookie, urlParams.get('id'));
        }
    });

    socket.on('reconnectSuccess', () => {
        // Handle successful reconnection (update UI or perform other actions)
        console.log('Successfully reconnected!');
    });

    socket.on('newCookie', (newCookie) => {

        console.log('Received new cookie:', newCookie);
        storeCookie(newCookie); // Store the new cookie for future use

        window.username = getUsername('Ingresa tu nombre para participar en la subasta');
        socket.emit('register', { name: username, auctionId: urlParams.get('id') });
    });

    socket.on('registrationSuccess', (username, isMaster) => {
        window.isMaster = isMaster;
        document.getElementById('username').innerText = `Nombre: ${username}`;
        const decodeAuctionDetails = decodeDetails(urlParams.get('id'));
        window.price = decodeAuctionDetails.basePrice;
        window.duration = decodeAuctionDetails.duration;
        window.item = decodeAuctionDetails.name;
        document.getElementById('item').innerText = window.item;
        window.minimalPrice = decodeAuctionDetails.minimalPrice;
        if (window.isMaster) {
            document.querySelector('.controls-section').hidden = false;
        }
        updateFlipClock();
        document.getElementById('auction').style.opacity = 1;
    });

    socket.on('auctionAlreadyStarted', () => {
        document.getElementById('username').innerText = `${window.username}`;
        document.getElementById('auction').style.opacity = 1;
    });

    socket.on('retryRegister', () => {
        window.username = getUsername('Usuario ya registrado usa otro nombre');
        socket.emit('register', { name: window.username, auctionId: urlParams.get('id') });
    });

    socket.on('tick', (newPrice) => {
        if (window.intervalId == null) {
            window.price = newPrice;
            updateFlipClock();
        }
    });

    socket.on('startingAuction', () => {
        if (!window.isMaster) {
            document.querySelector('.bid-section').hidden = false;
        }
    });

    socket.on('wrongAuction', (auctionId) => {
        alert('Sigues conectado a otra subasta primero desconectate.');
        window.location.href = `${window.location.origin}${window.location.pathname}?id=${auctionId}`;
    });

    socket.on('endAuction', (soldTo, soldBy) => {
        if (window.isMaster) {
            clearInterval(window.intervalId);
            window.intervalId = null;
        }
        document.querySelector('.bid-section').hidden = false;
        document.getElementById('endAuctionBtn').hidden = true;
        document.getElementById('endAuctionBtn').hidden = true;
        document.getElementById('price-clock').addEventListener("transitionend", () => {
            document.getElementById('sellTo').hidden = false;
            document.getElementById('sellTo').innerHTML = `Vendido a: ${soldTo}`;
            document.getElementById('sellBy').hidden = false;
            document.getElementById('sellBy').innerHTML = `Por ${soldBy}`;
        });
    });

    socket.on('updateParticipants', (participants) => {
        const participantsList = document.getElementById('participants');
        participantsList.innerHTML = ''; // Clear the list before updating

        // Update the list of participants excluding the master
        participants.forEach(participant => {
            if (participant !== window.username) {
                const li = document.createElement('li');
                li.innerText = participant;
                participantsList.appendChild(li);
            }
        });
    });

    if (window.isMaster) {
        document.querySelector('.controls-section').hidden = false;
    }

    document.getElementById('username').addEventListener('click', () => {
        window.username = getUsername('Ingresa tu nombre para participar en la subasta');
        socket.emit('register', { name: username, auctionId: urlParams.get('id') });
    });

    document.getElementById('exitAuctionBtn').addEventListener('click', () => {
        socket.emit('exitAuction');
        window.location.href = `${window.location.origin}${window.location.pathname}`;
    });

    document.getElementById('endAuctionBtn').addEventListener('click', () => {
        socket.emit('endAuction', window.price);
    });

    document.getElementById('startAuctionBtn').addEventListener('click', () => {
        if (window.isMaster) {
            document.querySelector('.controls-section').hidden = true;
            socket.emit('startAuction');
            setTimeout(() => {
                window.reduction = (Math.trunc(((window.price - window.minimalPrice) / window.duration) * 100) / 100).toFixed(2);;
                let count = 0;
                window.intervalId = setInterval(() => {
                    count++;
                    if (count == duration) {
                        window.price = window.minimalPrice;
                        updateFlipClock();
                        socket.emit('tick', window.price);
                    }
                    if (count >= duration) {
                        socket.emit('endAuction', window.username);
                        clearInterval(window.intervalId);
                        return;
                    }
                    window.price -= window.reduction;
                    updateFlipClock();
                    socket.emit('tick', window.price);
                }, 1000);
            }, 3000);
        }
    });
})();


function updateFlipClock() {
    document.getElementById('price-clock').style.setProperty("--price", window.price);
}
