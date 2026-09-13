// Every remaining FIFA member's name pool, merged into UNLISTED_NATIONALITIES
// below. It imports only the `NationalityDef` TYPE back from here, so there is
// no runtime import cycle.
import { WORLD_NATIONALITIES } from "./worldNationalities.js";

// Premier League nationality distribution + per-country name pools.
// Weights are relative (not percentages): a country with weight 300 appears
// ~2x as often as weight 150.
//
// Name pools are common civilian names for each country — deliberately NOT
// the names of real footballers, so generated players never read as (or
// combine into) recognizable pros.
//
// Pool sizes scale with how many players a nationality actually generates, not
// with its `weight`: a nation's realized count is the sum of its share across
// every league table (plus the REST tail), so a low-weight nation named by many
// leagues — Senegal, Morocco, Ivory Coast — produces far more players than its
// weight suggests, and a home-league country produces ~500. A name is one draw
// from `first` x one from `last`, so a 10x10 pool covers 100 names against a
// world that generates 8000 players. Rough targets: home-league countries
// ~90x96, heavy tail suppliers ~52x52, mid ~36x36, rare ~24x24. Names within a
// list must be unique and ASCII-only (no accents) — `nationalities.test.ts`
// pins both plus the size floors. `scripts/namePoolProbe.ts` measures the
// duplicate rate a real generated world ends up with.
export interface NationalityDef {
  weight: number;
  first: string[];
  last: string[];
}

export const NATIONALITIES: Record<string, NationalityDef> = {
  England: {
    weight: 390,
    first: [
      "Harry", "Jack", "James", "George", "Jordan", "Callum", "Mason", "Tyler",
      "Charlie", "Oliver", "Ben", "Sam", "Ryan", "Josh", "Luke", "Connor",
      "Aaron", "Marcus", "Dominic", "Reece", "Curtis", "Ellis", "Kyle", "Declan",
      "Thomas", "Daniel", "Matthew", "Adam", "Nathan", "Liam", "Joe", "Alfie",
      "Archie", "Freddie", "Louie", "Theo", "Ethan", "Noah", "Leo", "Max",
      "Finley", "Toby", "Elliot", "Cameron", "Bradley", "Lewis", "Owen", "Jake",
      "Dylan", "Harvey", "Billy", "Frankie", "Alex", "Will", "Scott", "Andy",
      "Danny", "Michael", "Robbie", "Joel", "Patrick", "Stephen", "Christopher", "Andrew",
      "Peter", "Philip", "Richard", "Robert", "William", "Edward", "Henry", "Charles",
      "Isaac", "Jacob", "Jamie", "Jason", "Jay", "Kieran", "Lee", "Mark",
      "Martin", "Neil", "Nick", "Paul", "Sean", "Simon", "Steven", "Stuart",
      "Tim", "Tom", "Tony", "Victor", "Wayne", "Zach", "Reggie", "Stanley",
    ],
    last: [
      "Smith", "Jones", "Taylor", "Wilson", "Johnson", "White", "Walker", "Robinson",
      "Wright", "Green", "Hall", "Wood", "Baker", "Clarke", "Cooper", "Ward",
      "Hunt", "Foster", "Bennett", "Grant", "Thompson", "Evans", "Roberts", "Turner",
      "Hill", "Moore", "Clark", "Harris", "Lewis", "Allen", "Young", "King",
      "Scott", "Adams", "Mitchell", "Carter", "Phillips", "Parker", "Collins", "Edwards",
      "Morris", "Murphy", "Cook", "Bailey", "Bell", "Kelly", "Howard", "Marsh",
      "Dawson", "Fletcher", "Simpson", "Hudson", "Barnes", "Chapman", "Gibson", "Harrison",
      "Holmes", "Lawson", "Pearson", "Webster", "Atkinson", "Barker", "Bishop", "Brooks",
      "Burton", "Butler", "Cole", "Cox", "Davies", "Day", "Ellis", "Fisher",
      "Fox", "Freeman", "Graham", "Gray", "Griffiths", "Harper", "Hart", "Hawkins",
      "Hayes", "Holland", "Hopkins", "Hughes", "Jackson", "James", "Jenkins", "Knight",
      "Lane", "Lawrence", "Lee", "Lloyd", "Long", "Lowe", "Mason", "Mills",
      "Morgan", "Palmer", "Payne", "Perry", "Powell", "Price", "Reed", "Reid",
      "Richards", "Russell", "Shaw", "Stone", "Sutton", "Walsh", "Watts", "Wells",
    ],
  },
  France: {
    weight: 63,
    first: [
      "Antoine", "Paul", "Hugo", "Theo", "Lucas", "Adrien", "Benjamin", "Thomas",
      "Jules", "Louis", "Leo", "Gabriel", "Raphael", "Arthur", "Nathan", "Ethan",
      "Enzo", "Maxime", "Quentin", "Clement", "Romain", "Julien", "Nicolas", "Alexandre",
      "Baptiste", "Florian", "Guillaume", "Mathis", "Noah", "Sacha", "Yanis", "Mehdi",
      "Karim", "Samir", "Amine", "Ibrahim", "Moussa", "Mamadou", "Idrissa", "Sekou",
      "Pierre", "Francois", "Philippe", "Laurent", "Olivier", "Christophe", "Sebastien", "Damien",
      "Fabien", "Jerome", "Matthieu", "Vincent", "Yann", "Remi", "Thierry", "Alain",
      "Bruno", "Denis", "Eric", "Frederic", "Gregory", "Herve", "Jacques", "Marc",
      "Pascal", "Patrice", "Sylvain", "Xavier", "Yves", "Aurelien", "Bastien", "Corentin",
      "Didier", "Emmanuel", "Fabrice", "Gael", "Hakim", "Ismael", "Jordan", "Loic",
      "Alexis", "Anthony", "Arnaud", "Axel", "Cedric", "Cyril", "Dorian", "Edouard",
      "Evan", "Gabin", "Gaspard", "Lorenzo", "Marius", "Nolan", "Rayan", "Sofiane",
      "Steven", "Tom", "Valentin", "Younes",
    ],
    last: [
      "Martin", "Bernard", "Dubois", "Durand", "Moreau", "Laurent", "Simon", "Michel",
      "Lefebvre", "Leroy", "Roux", "Fournier", "Girard", "Bonnet", "Dupont", "Lambert",
      "Fontaine", "Rousseau", "Vincent", "Faure", "Andre", "Mercier", "Blanc", "Guerin",
      "Boyer", "Garnier", "Chevalier", "Francois", "Legrand", "Gauthier", "Perrin", "Robin",
      "Clement", "Morel", "Henry", "Renard", "Picard", "Marchand", "Traore", "Diallo",
      "Barbier", "Bertrand", "Blanchard", "Caron", "Colin", "Denis", "Deschamps", "Dufour",
      "Dupuis", "Fabre", "Fernandez", "Garcia", "Gautier", "Gerard", "Giraud", "Hubert",
      "Jacquet", "Klein", "Lacroix", "Leclerc", "Lecomte", "Lemoine", "Lopez", "Martinez",
      "Masson", "Meyer", "Morin", "Muller", "Nguyen", "Olivier", "Paris", "Petit",
      "Philippe", "Renaud", "Rey", "Richard", "Robert", "Rodriguez", "Roy", "Schmitt",
      "Barre", "Baudry", "Besson", "Bourgeois", "Brun", "Camus", "Carpentier", "Cordier",
      "Coste", "Delaunay", "Dumas", "Duval", "Gaillard", "Gillet", "Guillot", "Hamon",
      "Lacombe", "Langlois", "Lebrun", "Marty", "Menard", "Millet", "Moulin", "Noel",
      "Poirier", "Prevost", "Riviere", "Rolland", "Sauvage", "Tessier", "Vasseur", "Verdier",
    ],
  },
  Brazil: {
    weight: 63,
    first: [
      "Gabriel", "Lucas", "Rodrigo", "Thiago", "Danilo", "Everton", "Matheus", "Douglas",
      "Renan", "Arthur", "Fabio", "Rafael", "Pedro", "Joao", "Felipe", "Gustavo",
      "Leonardo", "Marcelo", "Vitor", "Caio", "Diego", "Igor", "Andre", "Henrique",
      "Julio", "Leandro", "Murilo", "Otavio", "Paulo", "Ramon", "Samuel", "Sergio",
      "Wesley", "Wallace", "Yago", "Alex", "Emerson", "Kaique", "Davi", "Luan",
      "Adriano", "Alan", "Bernardo", "Bruno", "Carlos", "Cesar", "Claudio", "Cleber",
      "Eduardo", "Erick", "Ezequiel", "Fernando", "Francisco", "Guilherme", "Heitor", "Hugo",
      "Isaac", "Jean", "Jonathan", "Jorge", "Jose", "Juliano", "Kevin", "Luis",
      "Manoel", "Marcos", "Mauricio", "Michel", "Miguel", "Nicolas", "Osvaldo", "Patrick",
      "Ricardo", "Roberto", "Rodolfo", "Rogerio", "Silvio", "Tiago", "Victor", "Wagner",
      "Wellington", "William", "Yuri", "Caua", "Renato", "Filipe", "Antonio", "Edson",
      "Anderson", "Breno", "Cristiano", "Daniel", "Ederson", "Elias", "Enzo", "Fabricio",
      "Geovane", "Ian", "Jadson", "Kaua", "Lorenzo", "Maicon", "Nathan", "Vinicius",
    ],
    last: [
      "Silva", "Santos", "Souza", "Oliveira", "Costa", "Pereira", "Ferreira", "Alves",
      "Barbosa", "Ribeiro", "Carvalho", "Gomes", "Martins", "Araujo", "Nascimento", "Rocha",
      "Dias", "Moreira", "Cardoso", "Teixeira", "Correia", "Lima", "Fernandes", "Neves",
      "Almeida", "Azevedo", "Batista", "Borges", "Campos", "Castro", "Cavalcanti", "Duarte",
      "Farias", "Freitas", "Mendes", "Monteiro", "Nogueira", "Pinto", "Ramos", "Vieira",
      "Aguiar", "Amaral", "Andrade", "Antunes", "Assis", "Barros", "Bezerra", "Brito",
      "Caldeira", "Cunha", "Dantas", "Figueiredo", "Franco", "Guimaraes", "Lacerda", "Leite",
      "Machado", "Magalhaes", "Marques", "Medeiros", "Melo", "Miranda", "Mota", "Moraes",
      "Moura", "Nunes", "Paiva", "Peixoto", "Pinheiro", "Reis", "Sales", "Santiago",
      "Siqueira", "Soares", "Torres", "Vargas", "Xavier", "Alencar", "Bastos", "Bittencourt",
      "Brandao", "Camargo", "Carneiro", "Chaves", "Coelho", "Damasceno", "Fagundes", "Fontes",
      "Furtado", "Godoy", "Guedes", "Lisboa", "Macedo", "Maia", "Marinho", "Menezes",
      "Padilha", "Prado", "Rangel", "Sampaio", "Tavares", "Valente", "Vasconcelos", "Veloso",
      "Vilela",
    ],
  },
  Spain: {
    weight: 33,
    first: [
      "Alvaro", "Sergio", "Pablo", "Pedro", "Alejandro", "Marco", "Dani", "Rodrigo",
      "Jesus", "Cesar", "Ivan", "Ruben", "Diego", "Carlos", "Mikel", "Unai",
      "Adrian", "Alberto", "Antonio", "David", "Fernando", "Francisco", "Gonzalo", "Hector",
      "Hugo", "Javier", "Jorge", "Manuel", "Miguel", "Raul", "Andres", "Angel",
      "Asier", "Borja", "Daniel", "Eduardo", "Enrique", "Felix", "Gabriel", "Guillermo",
      "Ignacio", "Ismael", "Jaime", "Jon", "Jose", "Julian", "Luis", "Marc",
      "Mario", "Martin", "Nicolas", "Oscar", "Pau", "Ramon", "Ricardo", "Roberto",
      "Salvador", "Samuel", "Tomas", "Victor", "Xavier", "Yeray", "Aitor", "Aleix",
      "Alfonso", "Arnau", "Bruno", "Cristian", "Dario", "Emilio", "Fabian", "Gerard",
      "German", "Gorka", "Hernan", "Iago", "Iker", "Inigo", "Isaac", "Izan",
      "Joan", "Joel", "Jonathan", "Josep", "Juan", "Julio", "Lucas", "Marcos",
      "Mateo", "Nacho", "Oriol", "Pol", "Rafael", "Santiago", "Sergi", "Toni",
      "Vicente",
    ],
    last: [
      "Garcia", "Rodriguez", "Fernandez", "Lopez", "Martinez", "Gonzalez", "Perez", "Sanchez",
      "Gomez", "Martin", "Jimenez", "Ruiz", "Hernandez", "Diaz", "Moreno", "Munoz",
      "Alvarez", "Romero", "Gutierrez", "Alonso", "Navarro", "Dominguez", "Vazquez", "Gil",
      "Serrano", "Molina", "Castro", "Ortega", "Delgado", "Aguilar", "Benitez", "Cabrera",
      "Campos", "Cano", "Carrasco", "Castillo", "Cortes", "Crespo", "Domingo", "Duran",
      "Escudero", "Esteban", "Ferrer", "Flores", "Gallego", "Garrido", "Guerrero", "Herrera",
      "Hidalgo", "Ibanez", "Iglesias", "Leon", "Lozano", "Marin", "Medina", "Mendez",
      "Miranda", "Montero", "Morales", "Nieto", "Ochoa", "Pascual", "Pastor", "Pena",
      "Prieto", "Ramirez", "Ramos", "Reyes", "Rios", "Rivera", "Rubio", "Santos",
      "Sanz", "Soto", "Suarez", "Torres", "Vega", "Arias", "Bravo", "Calvo",
      "Carmona", "Cuesta", "Diez", "Fuentes", "Gallardo", "Herrero", "Izquierdo", "Lara",
      "Lorenzo", "Luque", "Marquez", "Merino", "Mora", "Nunez", "Palacios", "Pardo",
      "Parra", "Rey", "Rivas", "Roldan", "Salas", "Sierra", "Varela", "Vidal",
      "Zamora",
    ],
  },
  Portugal: {
    weight: 31,
    first: [
      "Joao", "Diogo", "Ruben", "Pedro", "Rafael", "Nuno", "Goncalo", "Vitor",
      "Rui", "Nelson", "Andre", "Jose", "Fabio", "Tiago", "Bruno", "Miguel",
      "Ricardo", "Hugo", "Paulo", "Sergio", "Carlos", "Antonio", "Manuel", "Francisco",
      "Duarte", "Afonso", "Martim", "Tomas", "Vasco", "Simao", "Bernardo", "Daniel",
      "David", "Eduardo", "Filipe", "Guilherme", "Henrique", "Jaime", "Jorge", "Leonardo",
      "Luis", "Marco", "Mario", "Matias", "Renato", "Rodrigo", "Samuel", "Xavier",
      "Armando", "Emanuel", "Felipe", "Gaspar", "Inacio", "Luciano", "Alexandre", "Alvaro",
      "Artur", "Augusto", "Caetano", "Cesar", "Custodio", "Dinis", "Domingos", "Edgar",
      "Elias", "Ernesto", "Fernando", "Gil", "Gilberto", "Gustavo", "Helder", "Hernani",
      "Horacio", "Ivo", "Joaquim", "Julio", "Lourenco", "Lucas", "Marcelo", "Mateus",
      "Mauro", "Nicolau", "Norberto", "Octavio", "Osvaldo", "Patricio", "Raul", "Reinaldo",
      "Roberto", "Rogerio", "Salvador", "Sancho", "Sebastiao", "Silvio", "Teodoro", "Valentim",
      "Vicente", "Vitorino",
    ],
    last: [
      "Silva", "Pereira", "Costa", "Santos", "Ferreira", "Oliveira", "Rodrigues", "Martins",
      "Sousa", "Fonseca", "Goncalves", "Lopes", "Marques", "Alves", "Almeida", "Ribeiro",
      "Pinto", "Carvalho", "Teixeira", "Moreira", "Correia", "Mendes", "Nunes", "Soares",
      "Vieira", "Monteiro", "Cardoso", "Rocha", "Antunes", "Machado", "Azevedo", "Barbosa",
      "Borges", "Campos", "Coelho", "Cunha", "Dias", "Domingues", "Duarte", "Faria",
      "Freitas", "Gomes", "Leite", "Lima", "Lourenco", "Matos", "Miranda", "Neves",
      "Pacheco", "Paiva", "Pinheiro", "Reis", "Sa", "Sequeira", "Simoes", "Tavares",
      "Torres", "Vaz", "Ventura", "Abreu", "Aguiar", "Amaral", "Andrade", "Araujo",
      "Assuncao", "Baptista", "Barros", "Bastos", "Bento", "Bernardes", "Brito", "Cabral",
      "Camara", "Carmo", "Castro", "Chaves", "Cordeiro", "Cruz", "Esteves", "Fernandes",
      "Fialho", "Figueiredo", "Franco", "Galvao", "Garcia", "Godinho", "Guedes", "Guerreiro",
      "Henriques", "Jesus", "Lacerda", "Loureiro", "Macedo", "Magalhaes", "Maia", "Marinho",
      "Martinho", "Melo", "Mesquita", "Morais", "Moura", "Nogueira", "Pais", "Palma",
      "Passos", "Pedrosa", "Peixoto", "Pires", "Queiroz", "Ramos", "Rebelo", "Resende",
      "Salgado", "Sampaio", "Saraiva", "Silveira", "Valente", "Varela", "Vasconcelos", "Veloso",
    ],
  },
  Italy: {
    weight: 30,
    first: [
      "Marco", "Luca", "Matteo", "Alessandro", "Davide", "Simone", "Andrea", "Francesco",
      "Lorenzo", "Riccardo", "Federico", "Gianluca", "Stefano", "Fabio", "Roberto", "Paolo",
      "Giovanni", "Antonio", "Nicola", "Emanuele", "Daniele", "Cristian", "Filippo", "Enrico",
      "Salvatore", "Massimo", "Vincenzo", "Domenico", "Pietro", "Angelo", "Giuseppe", "Michele",
      "Alberto", "Claudio", "Giorgio", "Sergio", "Mario", "Franco", "Carlo", "Luigi",
      "Maurizio", "Fabrizio", "Alessio", "Gabriele", "Samuele", "Tommaso", "Leonardo", "Edoardo",
      "Giacomo", "Mattia", "Nicolo", "Manuel", "Diego", "Emiliano", "Valerio", "Dario",
      "Ivan", "Raffaele", "Rosario", "Silvio", "Vito", "Aldo", "Cesare", "Dino",
      "Ettore", "Flavio", "Gennaro", "Gianmarco", "Giulio", "Guido", "Ivano", "Lucio",
      "Marcello", "Mirko", "Orlando", "Osvaldo", "Renato", "Rocco", "Ruggero", "Sandro",
      "Saverio", "Tiziano", "Umberto", "Valentino", "Vittorio", "Alfonso", "Amedeo", "Arturo",
      "Corrado", "Elia", "Ferdinando", "Gaetano", "Nino", "Piero",
    ],
    last: [
      "Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci",
      "Marino", "Greco", "Bruno", "Gallo", "Conti", "De Luca", "Costa", "Giordano",
      "Mancini", "Rizzo", "Lombardi", "Moretti", "Barbieri", "Fontana", "Santoro", "Mariani",
      "Rinaldi", "Caruso", "Ferrara", "Galli", "Martini", "Leone", "Longo", "Gentile",
      "Martinelli", "Vitale", "Lombardo", "Serra", "Coppola", "De Santis", "D'Angelo", "Marchetti",
      "Parisi", "Villa", "Conte", "Ferraro", "Ferri", "Fabbri", "Bianco", "Marini",
      "Grasso", "Valentini", "Messina", "Sala", "De Angelis", "Gatti", "Pellegrini", "Palumbo",
      "Sanna", "Farina", "Rizzi", "Monti", "Cattaneo", "Morelli", "Amato", "Silvestri",
      "Mazza", "Testa", "Grassi", "Pellegrino", "Carbone", "Giuliani", "Benedetti", "Barone",
      "Rossetti", "Caputo", "Montanari", "Guerra", "Palmieri", "Bernardi", "Martino", "Fiore",
      "De Rosa", "Ferretti", "Bellini", "Basile", "Riva", "Donati", "Piras", "Vitali",
      "Battaglia", "Sartori", "Neri", "Costantini", "Milani", "Pagano", "Ruggiero", "Sorrentino",
    ],
  },
  Netherlands: {
    weight: 28,
    first: [
      "Daan", "Sem", "Lars", "Thijs", "Bram", "Luuk", "Jesse", "Tim",
      "Niels", "Sven", "Koen", "Ruben", "Stijn", "Joris", "Rick", "Tom",
      "Max", "Thomas", "Jasper", "Wouter", "Bas", "Gijs", "Floris", "Pim",
      "Jelle", "Sander", "Maarten", "Niek", "Teun", "Mees", "Arjan", "Bart",
      "Cas", "Dirk", "Erik", "Frank", "Geert", "Harm", "Hendrik", "Jan",
      "Jeroen", "Joep", "Kevin", "Martijn", "Nick", "Olivier", "Pieter", "Rens",
      "Roan", "Robin", "Ronald", "Stef", "Vincent", "Wesley", "Casper", "Daniel",
      "Douwe", "Ferdi", "Gerrit", "Guus", "Hidde", "Huub", "Jaap", "Jorrit",
      "Justin", "Kees", "Klaas", "Lucas", "Marnix", "Matthijs", "Menno", "Mick",
      "Milan", "Nils", "Owen", "Quinten", "Reinier", "Roel", "Ruud", "Siem",
      "Sil", "Thijmen", "Willem", "Wim", "Youri", "Bauke",
    ],
    last: [
      "de Vries", "Jansen", "van den Berg", "Bakker", "Visser", "Smit", "Meijer", "Mulder",
      "Bos", "Vos", "Peters", "Hendriks", "Dekker", "Brouwer", "van Leeuwen", "de Boer",
      "Kuipers", "Veenstra", "Prins", "Huisman", "van der Meer", "Postma", "Scholten", "Willems",
      "Timmermans", "Verhoeven", "Kok", "Jacobs", "Schouten", "Maas", "van Dijk", "van der Wal",
      "van Wijk", "Vink", "Wolters", "Kramer", "Hoekstra", "Dijkstra", "van der Linden", "Groen",
      "Blom", "Koster", "Peeters", "Sanders", "Martens", "Hermans", "van Dam", "Boer",
      "Vermeer", "Kuiper", "Brink", "Groot", "Smits", "Verbeek", "Beekman", "Boersma",
      "Bosch", "Bruins", "Coenen", "Cornelissen", "Dekkers", "Doornbos", "Driessen", "Elzinga",
      "Evers", "Faber", "Franken", "Gerritsen", "Haan", "Hofman", "Hoogland", "Janssen",
      "Kaptein", "Klomp", "Koning", "Kooij", "Kuijper", "Laan", "Lammers", "Meijerink",
      "Mol", "Nijhuis", "Nijland", "Rietveld", "Roelofs", "Rutten", "Schaap", "Schipper",
      "Steenbergen", "Terpstra", "Vermeulen", "Zwart",
    ],
  },
  Belgium: {
    weight: 22,
    first: [
      "Lucas", "Arthur", "Noah", "Louis", "Victor", "Jules", "Adam", "Nathan",
      "Thomas", "Maxime", "Simon", "Antoine", "Romain", "Gilles", "Wout", "Senne",
      "Lars", "Milan", "Robbe", "Seppe", "Kobe", "Jarne", "Brent", "Cedric",
      "Bram", "Dries", "Emile", "Fabrice", "Francois", "Gregory", "Hugo", "Jens",
      "Jonas", "Kevin", "Laurent", "Matthias", "Nicolas", "Olivier", "Pieter", "Quentin",
      "Stijn", "Thibault", "Tim", "Vincent", "Yannick", "Aaron", "Alexander", "Andreas",
      "Arne", "Axel", "Bart", "Benoit", "Christophe", "Daan", "Damien", "David",
      "Dorian", "Elias", "Emiel", "Ferre", "Filip", "Florian", "Geoffrey", "Gert",
      "Guillaume", "Hendrik", "Jan", "Jarno", "Jasper", "Jean", "Jeroen", "Joachim",
      "Joris", "Julien", "Karel", "Koen", "Lander", "Lennert", "Loic", "Luca",
      "Marius", "Martin", "Mathis", "Maxence", "Michiel", "Nico", "Niels", "Pierre",
      "Rik", "Robin", "Ruben", "Sam", "Sander", "Sebastien", "Siebe", "Stan",
      "Stef", "Steven", "Sven", "Tibo", "Tom", "Toon", "Tristan", "Ward",
      "Wim", "Xander", "Yves",
    ],
    last: [
      "Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens",
      "Wouters", "De Smet", "Vermeulen", "Hermans", "Pauwels", "Michiels", "Aerts", "De Clercq",
      "Dubois", "Lambert", "Dupont", "Leclercq", "Renard", "Denis", "Lemaire", "Segers",
      "Claessens", "De Backer", "De Cock", "Desmet", "Devos", "Dewaele", "Geerts", "Hendrickx",
      "Lejeune", "Martens", "Meeus", "Moens", "Peters", "Stevens", "Thijs", "Van den Bossche",
      "Verstraeten", "Baert", "Cools", "De Vos", "Engels", "Francken", "Leclerc", "Maertens",
      "Adriaensen", "Bauwens", "Beckers", "Bogaert", "Boons", "Borremans", "Bosmans", "Ceulemans",
      "Charlier", "Christiaens", "Collin", "Coppens", "Cornelis", "Daems", "De Keyser", "De Meyer",
      "De Pauw", "De Ridder", "De Wilde", "Delvaux", "Dumont", "Fontaine", "Gerard", "Gilis",
      "Hubert", "Huys", "Jacques", "Janssen", "Lallemand", "Laurent", "Lecomte", "Legrand",
      "Lemoine", "Lenaerts", "Leroy", "Lievens", "Luyten", "Marchal", "Mercier", "Nys",
      "Poncelet", "Raes", "Rousseau", "Schmitz", "Simon", "Smet", "Snoeck", "Theys",
      "Timmermans", "Van Acker", "Van Damme", "Van Dyck", "Van Hoof", "Van Loo", "Van Rompaey", "Vandenberghe",
      "Vandevelde", "Verbeeck", "Vercammen", "Vergauwen", "Verhaeghe", "Verhoeven", "Verlinden", "Vermeersch",
      "Verstraete", "Wauters",
    ],
  },
  Argentina: {
    weight: 20,
    first: [
      "Nicolas", "Rodrigo", "Cristian", "Marcos", "German", "Nahuel", "Santiago", "Mateo",
      "Joaquin", "Facundo", "Agustin", "Franco", "Ignacio", "Lucas", "Matias", "Tomas",
      "Bruno", "Gonzalo", "Ezequiel", "Federico", "Leandro", "Maximiliano", "Ramiro", "Valentin",
      "Alejandro", "Andres", "Carlos", "Daniel", "Diego", "Emiliano", "Esteban", "Fabian",
      "Gabriel", "Guillermo", "Hernan", "Javier", "Juan", "Julian", "Lautaro", "Luciano",
      "Martin", "Mauro", "Pablo", "Patricio", "Ricardo", "Sebastian", "Sergio", "Victor",
      "Adrian", "Alan", "Axel", "Braian", "Damian", "Dante", "Dario", "Enzo",
      "Gaston", "Ivan", "Jonathan", "Kevin", "Milton", "Nazareno", "Thiago", "Uriel",
      // Deepened when Argentina became a home league (see LEAGUE_NATIONALITY_WEIGHTS),
      // which generates ~1,500 Argentines a world rather than the handful an import
      // tail supplies.
      "Rafael", "Emanuel", "Cristobal", "Lisandro", "Walter", "Hugo", "Raul", "Oscar",
      "Claudio", "Marcelo", "Eduardo", "Fernando", "Jorge", "Mariano", "Gustavo", "Leonel",
      "Bautista", "Benjamin",
    ],
    last: [
      "Gonzalez", "Rodriguez", "Gomez", "Fernandez", "Lopez", "Diaz", "Martinez", "Perez",
      "Garcia", "Sanchez", "Romero", "Sosa", "Alvarez", "Ruiz", "Ramirez", "Flores",
      "Benitez", "Acosta", "Medina", "Herrera", "Aguirre", "Pereyra", "Dominguez", "Molina",
      "Castro", "Correa", "Ferreyra", "Gimenez", "Gutierrez", "Ibarra", "Ledesma", "Luna",
      "Mansilla", "Morales", "Navarro", "Ortiz", "Peralta", "Rios", "Rojas", "Suarez",
      "Torres", "Vargas", "Vega", "Vera", "Villalba", "Zapata", "Silva", "Mendoza",
      "Arce", "Barrios", "Bustos", "Cabrera", "Cardozo", "Carrizo", "Coria", "Escobar",
      "Figueroa", "Godoy", "Guzman", "Juarez", "Leiva", "Maidana", "Ojeda", "Sandoval",
      "Paz", "Quiroga", "Benavidez", "Olivera", "Ponce", "Galvan", "Moreno", "Cano",
      "Acuna", "Villegas", "Aranda", "Montenegro", "Palacios", "Salinas", "Cejas", "Quintana",
      "Brizuela", "Chavez",
    ],
  },
  Scotland: {
    weight: 18,
    first: [
      "Andy", "John", "Scott", "Callum", "Ryan", "Kieran", "Stuart", "Grant",
      "Kenny", "Liam", "Billy", "Robbie", "Nathan", "Aaron", "Lewis", "Fraser",
      "Euan", "Cameron", "Finlay", "Ross",
      "Adam", "Alastair", "Angus", "Blair", "Calum", "Craig", "David", "Douglas",
      "Duncan", "Ewan", "Gavin", "Gregor", "Hamish", "Iain", "James", "Jamie",
      "Keith", "Malcolm", "Mark", "Murray", "Neil", "Rory", "Sean", "Steven",
      "Struan", "Gordon", "Hector", "Kenneth", "Lachlan", "Torquil", "Wallace", "Alasdair",
      "Bruce", "Fergus", "Graeme", "Innes", "Logan", "Murdo", "Niall", "Ranald",
      "Sorley", "Tavish", "Alistair", "Donald", "Hugh", "Kyle", "Magnus", "Norman",
      "Owen", "Roderick", "Somhairle", "Wilson", "Archibald", "Colin", "Dougal", "Kerr",
      "Rankin",
      // Scotland became a home league (see LEAGUE_NATIONALITY_WEIGHTS) and a
      // home league generates ~500 players a world rather than the handful a
      // foreign nationality contributes, so both pools were deepened to match
      // the other home countries. nationalities.test.ts enforces the 80 floor.
      "Andrew", "Barry", "Charlie", "Christopher", "Connor", "Darren", "Dean", "Declan",
      "Garry", "Greig", "Jack", "Jordan", "Kevin", "Michael", "Paul", "Peter",
      "Robert", "Shaun", "Stephen", "Tommy",
    ],
    last: [
      "Campbell", "Stewart", "MacDonald", "Murray", "Ross", "Reid", "Gray", "Duncan",
      "Hamilton", "Wallace", "Kerr", "Ferguson", "Grant", "Boyd", "Craig", "Sinclair",
      "Muir", "Bruce", "Douglas", "Burns",
      "Anderson", "Armstrong", "Bell", "Brown", "Clark", "Crawford", "Davidson", "Dickson",
      "Donaldson", "Fraser", "Gordon", "Graham", "Henderson", "Hunter", "Johnston", "Kelly",
      "MacKenzie", "MacLeod", "Marshall", "Mitchell", "Morrison", "Paterson", "Robertson", "Scott",
      "Simpson", "Smith", "Taylor", "Thomson", "Walker", "Watson", "Wilson", "Young",
      "Miller", "Mcdonald", "Cameron", "Kennedy", "Mackay", "Allan", "Gibson", "Docherty",
      "Forbes", "Gillespie", "Hendry", "Irvine", "Jardine", "Lamont", "Mcgregor", "Nicolson",
      "Ogilvie",
      "Aitken", "Baxter", "Blackwood", "Buchanan", "Cunningham", "Dalgleish", "Elliot", "Fleming",
      "Galloway", "Guthrie", "Hastie", "Inglis", "Kinnear", "Laing", "Lennox", "Lindsay",
      "MacFarlane", "MacIntyre", "MacNeil", "Maxwell", "McCall", "McInnes", "Menzies", "Moffat",
      "Napier", "Rennie", "Ritchie", "Sturrock", "Tait", "Urquhart", "Weir", "Whyte",
    ],
  },
  Wales: {
    weight: 16,
    first: [
      "Gareth", "Aaron", "Ben", "Joe", "Daniel", "Ethan", "Harry", "Rhys",
      "Connor", "Dylan", "Owen", "Morgan", "Ieuan", "Osian", "Tomos", "Gethin",
      "Iwan", "Cai", "Steffan", "Elis",
      "Adam", "Alun", "Arwyn", "Bryn", "Carwyn", "Dafydd", "Evan", "Geraint",
      "Gruffudd", "Harri", "Hywel", "Ioan", "Jac", "Llewelyn", "Marc", "Myrddin",
      "Rhodri", "Sion", "Trefor", "Wyn",
      "Owain", "Emlyn", "Bleddyn", "Eifion", "Huw", "Ifor", "Llyr", "Meirion",
      "Nathan", "Peredur", "Trystan", "Aled", "Bedwyr", "Ceri", "Deiniol", "Ffion",
      "Gwilym", "Idris", "Lewys", "Neil", "Padrig", "Rhydian", "Tudur", "Barri",
      "Cledwyn", "Dewi", "Emyr", "Hefin", "Islwyn", "Meredith", "Rheinallt", "Sior",
    ],
    last: [
      "Davies", "Williams", "Evans", "Thomas", "Roberts", "Hughes", "Morgan", "Griffiths",
      "Owen", "Rees", "Jenkins", "Powell", "Price", "Morris", "Lloyd", "Edwards",
      "Parry", "Pritchard", "Bowen", "Vaughan",
      "Bevan", "Ellis", "Harris", "Hopkins", "James", "Jones",
      "Lewis", "Phillips", "Prosser", "Richards", "Rowlands", "Walters",
      "Watkins", "Wynne", "Anthony", "Baker", "Cooper", "Fisher", "George", "Howells",
      "Meredith", "Havard", "Gwynn", "Probert", "Cadwallader", "Dyfed", "Flowers", "Gough",
      "Harries", "Ithel", "Kyffin", "Llewellyn", "Maddocks", "Nicholas", "Onions", "Pugh",
      "Rhys", "Samuel", "Trahaearn", "Vaughn", "Beynon", "Cadogan", "Dowell", "Elias",
      "Foulkes", "Gittins", "Hopkin", "Jarman",
    ],
  },
  "Republic of Ireland": {
    weight: 15,
    first: [
      "Sean", "Shane", "Conor", "Josh", "Nathan", "Callum", "Adam", "Jason",
      "Evan", "Cian", "Darragh", "Eoin", "Fionn", "Oisin", "Padraig", "Ronan",
      "Tadhg", "Cathal", "Niall", "Dara",
      "Aaron", "Barry", "Brendan", "Brian", "Ciaran", "Colm", "Damien", "Darren",
      "Declan", "Donal", "Eamon", "Enda", "Gary", "Ian", "Jack", "James",
      "Kevin", "Liam", "Mark", "Martin", "Michael", "Patrick", "Paul", "Peter",
      "Ruairi", "Aidan", "Fergal", "Gearoid", "Micheal", "Odhran", "Peadar", "Rory",
      "Seamus", "Tomas", "Ultan", "Aoghan", "Barra", "Finbar", "Garvan", "Iarla",
      "Killian", "Lorcan", "Malachy", "Naoise", "Oran", "Proinsias", "Riain", "Senan",
      "Turlough", "Aengus", "Breandan", "Conall", "Diarmuid", "Eanna", "Feidhlim", "Gerard",
      "Ianto", "Keelan", "Lochlann", "Muiris", "Nollaig",
    ],
    last: [
      "Murphy", "Kelly", "O'Sullivan", "Walsh", "O'Brien", "Byrne", "Ryan", "O'Connor",
      "O'Neill", "Reilly", "Doyle", "McCarthy", "Gallagher", "Doherty", "Kennedy", "Lynch",
      "Murray", "Quinn", "Moore", "Nolan",
      "Brennan", "Burke", "Carroll", "Casey", "Clarke", "Collins", "Connolly", "Daly",
      "Dunne", "Farrell", "Fitzgerald", "Flynn", "Graham", "Hayes", "Healy", "Hogan",
      "Keane", "Kearney", "Maher", "McGrath", "McMahon", "Moran", "O'Donnell", "Power",
      "Regan", "Sheridan", "Sweeney", "Whelan",
      "OSullivan", "Smith", "OBrien", "OConnor", "ONeill", "OReilly", "McLoughlin", "OCarroll",
      "OConnell", "Wilson", "Campbell", "Johnston", "Hughes", "Brown", "Martin", "Maguire",
      "Thompson", "OCallaghan", "ODonnell", "Duffy", "OMahony", "Boyle", "Shea", "White",
      "Kavanagh",
    ],
  },
  Denmark: {
    weight: 14,
    first: [
      "Mikkel", "Rasmus", "Jonas", "Simon", "Mathias", "Frederik", "Emil", "Oliver",
      "Magnus", "Oscar", "Malthe", "Anders", "Jacob", "Tobias", "Nikolaj", "Soren",
      "Mads", "Kasper", "Lasse", "Gustav", "Alexander", "Benjamin", "Christian", "Daniel",
      "Elias", "Filip", "Henrik", "Jesper", "Johan", "Kristian", "Martin", "Morten",
      "Noah", "Peter", "Sebastian", "Thomas", "Victor", "William", "Aksel", "Albert",
      "Anton", "Asger", "August", "Bertram", "Carl", "Esben", "Hans", "Jens",
      "Jeppe", "Joakim", "Jorgen", "Karl", "Kim", "Klaus", "Lars", "Ludvig",
      "Marcus", "Mikael", "Nikolai", "Ole", "Steffen", "Svend", "Theodor", "Valdemar",
    ],
    last: [
      "Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sorensen",
      "Rasmussen", "Jorgensen", "Petersen", "Madsen", "Kristensen", "Olsen", "Thomsen", "Christiansen",
      "Poulsen", "Johansen", "Mortensen", "Knudsen", "Berg", "Carlsen", "Eriksen", "Frederiksen",
      "Holm", "Jacobsen", "Kjaer", "Lauridsen", "Moller", "Olesen", "Schmidt", "Vestergaard",
      "Bach", "Bech", "Bertelsen", "Bruun", "Clausen", "Dahl", "Damgaard", "Friis",
      "Gregersen", "Hedegaard", "Henriksen", "Hermansen", "Iversen", "Jepsen", "Kjeldsen", "Kruse",
      "Lassen", "Lind", "Mikkelsen", "Munk", "Nissen", "Norgaard", "Overgaard", "Ravn",
      "Riis", "Simonsen", "Skov", "Sondergaard", "Steffensen", "Toft", "Vinther", "Winther",
    ],
  },
  Germany: {
    weight: 13,
    first: [
      "Lukas", "Finn", "Jonas", "Leon", "Paul", "Felix", "Maximilian", "Jan",
      "Tim", "Niklas", "Fabian", "Florian", "Tobias", "Moritz", "Philipp", "Sebastian",
      "Simon", "David", "Erik", "Hannes", "Alexander", "Andreas", "Benjamin", "Christian",
      "Daniel", "Dominik", "Elias", "Franz", "Georg", "Henrik", "Jakob", "Johannes",
      "Julian", "Kevin", "Lars", "Manuel", "Marcel", "Markus", "Martin", "Matthias",
      "Michael", "Nico", "Oliver", "Patrick", "Peter", "Robert", "Stefan", "Thomas",
      "Tom", "Wolfgang", "Adrian", "Anton", "Arne", "Bastian", "Bernd", "Carl",
      "Christoph", "Clemens", "Dennis", "Dirk", "Emil", "Ferdinand", "Gregor", "Gunter",
      "Hendrik", "Holger", "Ingo", "Jannik", "Jens", "Joachim", "Jonathan", "Jorg",
      "Karl", "Klaus", "Konstantin", "Leonard", "Linus", "Ludwig", "Marius", "Maurice",
      "Norbert", "Rainer", "Ralf", "Rene", "Sven", "Theo", "Torsten", "Uwe",
      "Valentin", "Vincent", "Volker", "Wilhelm",
    ],
    last: [
      "Muller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
      "Schulz", "Hoffmann", "Koch", "Bauer", "Richter", "Klein", "Wolf", "Schroder",
      "Neumann", "Braun", "Zimmermann", "Kruger", "Hartmann", "Lange", "Schmitt", "Werner",
      "Schwarz", "Hofmann", "Ziegler", "Brandt", "Kuhn", "Gunther", "Pohl", "Sauer",
      "Arnold", "Barth", "Busch", "Dietrich", "Engel", "Frank", "Fuchs", "Graf",
      "Haas", "Huber", "Jung", "Keller", "Konig", "Lang", "Maier", "Otto",
      "Peters", "Roth", "Schuster", "Vogel", "Albrecht", "Baumann", "Beck", "Berger",
      "Bergmann", "Bohm", "Brenner", "Ebert", "Eckert", "Fiedler", "Franke", "Freitag",
      "Gross", "Hahn", "Heinrich", "Herrmann", "Hess", "Horn", "Jager", "Kaiser",
      "Kern", "Kraus", "Krause", "Kuhlmann", "Lehmann", "Lorenz", "Mayer", "Moser",
      "Nagel", "Neubauer", "Ott", "Pfeiffer", "Reinhardt", "Riedel", "Ritter", "Schafer",
      "Schulte", "Seidel", "Sommer", "Stein", "Thiel", "Vogt", "Voigt", "Walter",
      "Weiss", "Winkler", "Zeller", "Zimmer",
    ],
  },
  Nigeria: {
    weight: 12,
    first: [
      "Chinedu", "Emeka", "Ifeanyi", "Chukwudi", "Obinna", "Uche", "Nnamdi", "Kelechi",
      "Adewale", "Ayodele", "Babatunde", "Olamide", "Segun", "Tunde", "Femi", "Musa",
      "Ibrahim", "Suleiman", "Daniel", "Samuel", "Abiodun", "Ademola", "Afolabi", "Ahmed",
      "Bamidele", "Bright", "Chibuike", "Chidi", "Chijioke", "Chima", "Chinonso", "Damilola",
      "Ebuka", "Ekene", "Emmanuel", "Gbenga", "Godwin", "Henry", "Ikechukwu", "Isaac",
      "Kayode", "Kunle", "Michael", "Nnaemeka", "Obiora", "Okechukwu", "Olumide", "Onyeka",
      "Sadiq", "Seyi", "Sunday", "Taiwo", "Temitope", "Yemi", "Yinka", "Zubairu",
      "Chukwuemeka", "Oluwaseun", "Chukwuma", "Ifeoma", "Jide", "Lekan", "Mustapha", "Nkem",
      "Peter", "Rotimi", "Tobechukwu", "Uzoma", "Wale", "Yusuf", "Chibuzor", "Dayo",
      "Folarin", "Ismaila", "Justice", "Lucky", "Ndubuisi", "Paul", "Victor", "Yakubu",
      "Adekunle", "Ganiyu",
    ],
    last: [
      "Okafor", "Okoye", "Eze", "Nwachukwu", "Obi", "Okonkwo", "Ogunleye", "Adeyemi",
      "Adebayo", "Balogun", "Lawal", "Yusuf", "Abubakar", "Mohammed", "Aliyu", "Chukwu",
      "Nnadi", "Olawale", "Oyelami", "Ekwueme", "Adeleke", "Adesina", "Afolayan", "Agbaje",
      "Ajayi", "Akinyemi", "Amadi", "Aminu", "Anyanwu", "Bello", "Chukwuma", "Ezeh",
      "Idowu", "Igwe", "Iwu", "Kalu", "Madu", "Nwankwo", "Nwosu", "Obasi",
      "Odili", "Ogundipe", "Ojo", "Okeke", "Okoli", "Olaniyan", "Olayinka", "Onwuka",
      "Osagie", "Oyeleke", "Sanusi", "Umeh", "Uzoma", "Adigun",
      "Okoro", "Ibrahim", "Musa", "Oyelaran", "Danjuma", "Egwuatu", "Fashola", "Ihenacho",
      "Madueke", "Ndidi", "Salami", "Udoh", "Achebe", "Bassey", "Chinedu", "Duru",
      "Emenike", "Falade", "Ige", "Jimoh", "Kanu", "Lawson", "Mbah", "Nnaji",
      "Ogbonna", "Peters", "Sanni", "Ugwu", "Williams", "Chiejine", "Dike", "Ekong",
      "Fatai", "Gbadamosi", "Iheanacho", "Jegede", "Kolawole",
    ],
  },
  Croatia: {
    weight: 10,
    first: [
      "Luka", "Ivan", "Marko", "Ante", "Josip", "Matej", "Petar", "Tomislav",
      "Stjepan", "Karlo", "Filip", "Lovro", "Roko", "Niko", "Fran", "Duje",
      "Andrej", "Bruno", "Damir", "Danijel", "Dario", "David", "Dominik", "Goran",
      "Hrvoje", "Igor", "Ivica", "Jakov", "Kristijan", "Leon", "Marin", "Mario",
      "Mateo", "Mihael", "Mislav", "Nikola", "Patrik", "Sandro", "Tin", "Vedran",
      "Domagoj", "Borna", "Stipe", "Toma", "Zvonimir", "Emil", "Matija", "Ozren",
      "Ratko", "Slaven", "Vinko", "Zlatko", "Andrija", "Bozo", "Erik", "Franjo",
      "Gabrijel", "Hrvoj", "Ilija", "Jure", "Kruno", "Nenad", "Oliver", "Pavao",
      "Rudolf", "Sime", "Viktor", "Zeljko",
    ],
    last: [
      "Horvat", "Kovacevic", "Babic", "Maric", "Jukic", "Vukovic", "Knezevic", "Tomic",
      "Novak", "Bozic", "Blazevic", "Grgic", "Saric", "Lovric", "Radic", "Filipovic",
      "Antic", "Barisic", "Bilic", "Brkic", "Cindric", "Colak", "Grubisic", "Ivancic",
      "Jelic", "Juric", "Klaric", "Kralj", "Lukic", "Marinovic", "Matic", "Miletic",
      "Pavic", "Petric", "Rukavina", "Simic", "Sokol", "Tolic", "Vidovic", "Zoric",
      "Kovacic", "Marusic", "Petrovic", "Pavlovic", "Bosnjak", "Cavic", "Dragic", "Erceg",
      "Franic", "Galic", "Hrvatin", "Ivanic", "Milic", "Nikolic", "Orsic", "Perisic",
      "Sesar", "Turkalj", "Vlahovic", "Delic", "Erak", "Franjic", "Gudelj", "Herceg",
      "Ivkovic", "Jakic", "Kolar", "Ljubic", "Mandic", "Nizic", "Opacak", "Prskalo",
      "Rebic",
    ],
  },
  Norway: {
    weight: 10,
    first: [
      "Magnus", "Henrik", "Jonas", "Sander", "Kristian", "Morten", "Fredrik", "Sondre",
      "Eirik", "Ola", "Lars", "Anders", "Even", "Sindre", "Vegard", "Petter",
      "Aksel", "Andreas", "Bjorn", "Daniel", "Einar", "Emil", "Erlend", "Espen",
      "Filip", "Geir", "Halvor", "Havard", "Jakob", "Jorgen", "Knut", "Marius",
      "Mathias", "Nikolai", "Oskar", "Rune", "Sigurd", "Simen", "Stian", "Trygve",
      "Oscar", "Viktor", "Elias", "Noah", "Liam", "Hugo", "Axel", "Alfred",
      "Vincent", "Melker", "Sixten", "Malte", "Nils", "Otto", "Frans", "Gustav",
      "Ivar", "Joel", "Kasper", "Ludvig", "Mattias", "Olof", "Rasmus", "Simon",
      "Torbjorn", "Ulf", "Valter", "Anton", "Birger", "Christoffer", "Didrik", "Folke",
      "Gunnar", "Halvard", "Ingemar", "Jesper", "Kristoffer", "Lennart", "Njal", "Peder",
      "Ragnar", "Sten", "Tobias", "Ulrik", "Vidar", "Age", "Bo", "Dag",
      "Erling", "Finn", "Georg",
    ],
    last: [
      "Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Pedersen", "Nilsen", "Kristiansen",
      "Jensen", "Karlsen", "Johnsen", "Pettersen", "Berg", "Haugen", "Hagen", "Dahl",
      "Aas", "Amundsen", "Bakke", "Bakken", "Brekke", "Christiansen", "Eide", "Ellingsen",
      "Engen", "Fjeld", "Gundersen", "Halvorsen", "Iversen", "Jacobsen", "Knutsen", "Lie",
      "Lund", "Moen", "Myhre", "Nygaard", "Ruud", "Solberg", "Strand", "Vik",
      "Eriksen", "Johannessen", "Andreassen", "Jorgensen", "Henriksen", "Sorensen", "Jakobsen", "Svendsen",
      "Knudsen", "Moe", "Rasmussen", "Kristoffersen", "Nygard", "Bratsberg", "Fossum", "Gran",
      "Holm", "Isaksen", "Kvam", "Lunde", "Naess", "Ottesen", "Rise", "Sandvik",
      "Thorsen",
    ],
  },
  Sweden: {
    weight: 9,
    first: [
      "Oscar", "William", "Lucas", "Elias", "Hugo", "Filip", "Anton", "Gustav",
      "Axel", "Erik", "Viktor", "Nils", "Adam", "Albin", "Melvin", "Casper",
      "Alexander", "Anders", "Andreas", "Arvid", "Benjamin", "Bjorn", "Christoffer", "Daniel",
      "David", "Edvin", "Emil", "Fredrik", "Gabriel", "Hampus", "Henrik", "Isak",
      "Jesper", "Johan", "Jonas", "Karl", "Ludvig", "Magnus", "Marcus", "Mattias",
      "Niklas", "Olle", "Patrik", "Rasmus", "Samuel", "Sebastian", "Simon", "Tobias",
      "Noah", "Liam", "Alfred", "Vincent", "Melker", "Sixten", "Malte", "Otto",
      "Frans", "Ivar", "Joel", "Kasper", "Olof", "Torbjorn", "Ulf", "Valter",
      "Birger", "Didrik", "Einar", "Folke", "Gunnar", "Halvard", "Ingemar", "Kristoffer",
      "Lennart", "Marius", "Njal", "Oskar", "Peder", "Ragnar", "Sten", "Ulrik",
      "Vidar", "Age", "Bo", "Dag", "Erling", "Finn", "Georg",
    ],
    last: [
      "Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson",
      "Svensson", "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson", "Lindberg",
      "Lindgren", "Lindqvist", "Berg", "Bergstrom", "Lundberg", "Lundgren", "Lundqvist", "Berglund",
      "Sandberg", "Nystrom", "Holm", "Sjoberg", "Wallin", "Engstrom", "Eklund", "Danielsson",
      "Hakansson", "Lind", "Fransson", "Blomqvist", "Nordstrom", "Ahlberg", "Falk", "Hedlund",
      "Isaksson", "Martensson", "Nyberg", "Oberg", "Sundberg", "Soderberg", "Strom", "Ostlund",
      "Jakobsson", "Magnusson", "Olofsson", "Lindstrom", "Axelsson", "Mattsson", "Fredriksson", "Henriksson",
      "Forsberg", "Lundin", "Bjork", "Gunnarsson", "Bergman", "Bjorklund", "Wikstrom", "Holmberg",
      "Samuelsson", "Ostberg",
    ],
  },
  Poland: {
    weight: 8,
    first: [
      "Jakub", "Kamil", "Wojciech", "Karol", "Jan", "Sebastian", "Piotr", "Mateusz",
      "Szymon", "Bartosz", "Michal", "Krzysztof", "Marcin", "Dawid", "Adam", "Adrian",
      "Aleksander", "Andrzej", "Antoni", "Artur", "Damian", "Dariusz", "Filip", "Grzegorz",
      "Igor", "Jacek", "Jerzy", "Kacper", "Konrad", "Lukasz", "Maciej", "Marek",
      "Mariusz", "Oskar", "Pawel", "Przemyslaw", "Rafal", "Robert", "Stanislaw", "Tomasz",
      "Ignacy", "Leszek", "Norbert", "Radoslaw", "Tadeusz", "Wiktor", "Zbigniew", "Arkadiusz",
      "Bogdan", "Cezary", "Eryk", "Gustaw", "Henryk", "Jaroslaw", "Lech", "Nikodem",
      "Olaf", "Patryk", "Slawomir", "Tymon", "Zygmunt", "Aleksy", "Blazej", "Czeslaw",
      "Dominik", "Emil", "Fabian", "Gabriel", "Hubert", "Kazimierz", "Nataniel", "Otto",
      "Roman", "Waldemar", "Zenon",
    ],
    last: [
      "Nowak", "Kowalski", "Wisniewski", "Wojcik", "Kowalczyk", "Kaminski", "Szymanski", "Wozniak",
      "Dabrowski", "Kozlowski", "Jankowski", "Mazur", "Krawczyk", "Piotrowski", "Adamczyk", "Andrzejewski",
      "Bak", "Baran", "Borkowski", "Chmielewski", "Czarnecki", "Duda", "Glowacki", "Gorski",
      "Grabowski", "Jablonski", "Jasinski", "Kaczmarek", "Kalinowski", "Kubiak", "Majewski", "Michalak",
      "Nowicki", "Olszewski", "Pawlak", "Sadowski", "Sikora", "Sokolowski", "Stepien", "Szewczyk",
      "Walczak", "Wieczorek", "Witkowski", "Wrobel", "Zajac", "Zalewski", "Zielinski", "Tomaszewski",
      "Nowakowski", "Pawlowski", "Michalski", "Dudek", "Krol", "Jaworski", "Malinowski", "Rutkowski",
      "Ostrowski", "Pietrzak", "Marciniak", "Jakubowski", "Zawadzki", "Szczepanski", "Kucharski", "Wilk",
      "Lis",
    ],
  },
  Ukraine: {
    weight: 8,
    first: [
      "Andriy", "Oleksandr", "Ruslan", "Mykola", "Viktor", "Artem", "Taras", "Yevhen",
      "Denys", "Illia", "Bohdan", "Dmytro", "Maksym", "Vladyslav", "Anatoliy", "Danylo",
      "Ihor", "Ivan", "Kyrylo", "Mykhailo", "Oleh", "Pavlo", "Petro", "Roman",
      "Serhiy", "Stanislav", "Vadym", "Volodymyr",
      "Vitaliy", "Yaroslav", "Rostyslav", "Vsevolod", "Arkadiy", "Valentyn", "Heorhiy", "Hryhoriy",
      "Kostyantyn", "Leonid", "Matviy", "Mykyta", "Rodion", "Semen", "Tymofiy", "Valeriy",
      "Yakiv", "Zakhar", "Arsen", "Borys", "Hennadiy", "Yefim", "Ihnat", "Kuzma",
      "Lev", "Myron", "Nazar", "Osyp", "Platon", "Sava", "Trokhym", "Ustym",
      "Pylyp", "Eduard", "Yulian", "German", "Klym", "Lavro", "Marko", "Naum",
      "Panas", "Ryhor", "Stepan", "Ulyan", "Vasyl", "Yakym", "Zinoviy", "Ales",
    ],
    last: [
      "Kovalenko", "Boyko", "Tkachenko", "Kravchenko", "Bondarenko", "Oliynyk", "Shevchuk", "Polishchuk",
      "Lysenko", "Rudenko", "Savchenko", "Melnyk", "Marchenko", "Kovalchuk", "Bondar", "Danylenko",
      "Hrytsenko", "Kharchenko", "Klymenko", "Kostenko", "Kravets", "Lytvyn", "Moroz", "Petrenko",
      "Romanenko", "Sydorenko", "Tymoshenko", "Zhuk",
      "Shevchenko", "Koval", "Tkachuk", "Havrylenko", "Zakharchenko", "Ishchenko", "Karpenko", "Levchenko",
      "Mykhailenko", "Nesterenko", "Ostapenko", "Panchenko", "Tarasenko", "Vasylenko", "Yakymenko", "Zinchenko",
      "Antonenko", "Bilyk", "Chorny", "Dovzhenko", "Fedorenko", "Ivanenko", "Kulyk", "Matviyenko",
      "Nazarenko", "Onyshchenko", "Pavlenko", "Radchenko", "Serhiyenko", "Trotsenko", "Usenko", "Voloshyn",
    ],
  },
  Ghana: {
    weight: 8,
    first: [
      "Kwame", "Kofi", "Kwesi", "Yaw", "Kojo", "Kwabena", "Akwasi", "Nana",
      "Ebenezer", "Prince", "Emmanuel", "Isaac", "Richmond", "Gideon", "Abdul", "Alhassan",
      "Bernard", "Bright", "Clement", "Daniel", "Divine", "Edmund", "Elvis", "Enoch",
      "Ernest", "Evans", "Felix", "Frank", "Godfred", "Ibrahim", "Joseph", "Kelvin",
      "Michael", "Nathaniel", "Patrick", "Samuel", "Selorm", "Solomon", "Stephen", "Kwadwo",
      "Kwaku", "Kwasi", "Richard", "Thomas", "Clifford", "Francis", "Harrison", "Jordan",
      "Lawrence", "Maxwell", "Osei", "Rashid", "Theophilus", "Vincent", "William", "Benjamin",
      "Charles", "Eric", "George", "Hakeem", "Isaiah", "James", "Kingsley", "Latif",
      "Mohammed", "Nicholas", "Philemon", "Raymond", "Seth", "Tetteh", "Yussif",
    ],
    last: [
      "Mensah", "Owusu", "Osei", "Boateng", "Asante", "Appiah", "Adjei", "Agyemang",
      "Ofori", "Amoah", "Darko", "Ankrah", "Tetteh", "Quaye", "Aboagye", "Acheampong",
      "Addo", "Adu", "Agyapong", "Amankwah", "Amoako", "Annan", "Anokye", "Antwi",
      "Asamoah", "Baffour", "Bediako", "Danso", "Donkor", "Duah", "Frimpong", "Gyamfi",
      "Kusi", "Nyarko", "Obeng", "Oduro", "Opoku", "Sarpong", "Tagoe", "Yeboah",
      "Gyasi", "Kwarteng", "Nkrumah", "Essien", "Koomson", "Larbi", "Manu", "Sekyere",
      "Twumasi", "Wiredu", "Fosu", "Gyimah", "Lartey", "Mireku", "Nti", "Poku",
      "Sackey", "Takyi", "Wemegah", "Ampofo", "Bonsu", "Dwomoh", "Fiifi", "Gyekye",
      "Kyei", "Marfo", "Nsiah", "Peprah", "Safo",
    ],
  },
  Serbia: {
    weight: 7,
    first: [
      "Nemanja", "Aleksandar", "Filip", "Luka", "Ivan", "Uros", "Marko", "Nikola",
      "Stefan", "Dusan", "Milos", "Vuk", "Petar", "Lazar", "Andrija", "Bogdan",
      "Bojan", "Boris", "Branislav", "Dejan", "Dragan", "Goran", "Igor", "Jovan",
      "Mihailo", "Milan", "Milorad", "Miroslav", "Nenad", "Ognjen", "Pavle", "Predrag",
      "Sasa", "Slobodan", "Srdjan", "Strahinja", "Vasilije", "Veljko", "Vladimir", "Zoran",
      "Djordje", "Danilo", "Ilija", "Kosta", "Relja", "Sava", "Aleksa", "Janko",
      "Konstantin", "Novak", "Radovan", "Vukasin", "Zeljko", "Bratislav", "Gavrilo", "Jaksa",
      "Kristijan", "Mladen", "Nebojsa", "Rastko",
      // Serbia became a home league (see LEAGUE_NATIONALITY_WEIGHTS), which
      // generates ~500 players a world against the handful a foreign
      // nationality contributes, so both pools were deepened to match the other
      // home countries. nationalities.test.ts enforces the 80 floor.
      "Arsenije", "Bogoljub", "Borislav", "Bozidar", "Cedomir", "Dalibor", "Darko", "Davor",
      "Desimir", "Dimitrije", "Dragoljub", "Dragoslav", "Dusko", "Gordan", "Grujica", "Jovica",
      "Ljubomir", "Milenko", "Miljan", "Milutin", "Mirko", "Momcilo", "Nedeljko", "Nikodije",
      "Ostoja", "Radisa", "Radoslav", "Ranko", "Sinisa", "Slavko", "Slavisa", "Spasoje",
      "Stanislav", "Svetozar", "Tadija", "Tihomir", "Vidoje", "Zivko",
    ],
    last: [
      "Jovanovic", "Petrovic", "Nikolic", "Markovic", "Djordjevic", "Stojanovic", "Stankovic", "Todorovic",
      "Ristic", "Zivkovic", "Lazic", "Vasic", "Simic", "Lukic", "Aleksic", "Antic",
      "Babic", "Bogdanovic", "Cvetkovic", "Dimitrijevic", "Djokic", "Ilic", "Jankovic", "Jeremic",
      "Kostic", "Krstic", "Milic", "Nedeljkovic", "Obradovic", "Pavlovic", "Popovic", "Radovanovic",
      "Stevanovic", "Tomic", "Vucetic", "Vukic", "Zdravkovic", "Milojevic",
      "Milosevic", "Blagojevic", "Filipovic", "Gajic", "Hadzic", "Kovacevic", "Lazarevic", "Mladenovic",
      "Rakic", "Savic", "Curcic", "Damjanovic", "Erakovic", "Gavrilovic", "Novakovic", "Perisic",
      "Radic", "Trifunovic", "Veselinovic", "Zoric", "Djukic", "Grujic", "Katic", "Maric",
      "Adamovic", "Andric", "Arsic", "Bajic", "Bakic", "Brankovic", "Cirkovic", "Despotovic",
      "Dragicevic", "Drakulic", "Glisic", "Ivanovic", "Jakovljevic", "Jelic", "Kecman", "Kljajic",
      "Knezevic", "Kuzmanovic", "Lalic", "Lekic", "Ljubicic", "Manojlovic", "Matic", "Micic",
      "Mihajlovic", "Mirkovic", "Nesic", "Nikodijevic", "Ostojic", "Pantic", "Paunovic",
      "Radenkovic", "Radulovic", "Sekulic", "Simonovic", "Stamenkovic", "Tanaskovic", "Vidic",
      "Zivanovic",
    ],
  },
  Cameroon: {
    weight: 7,
    first: [
      "Jean", "Paul", "Pierre", "Serge", "Alain", "Patrick", "Cyrille", "Rodrigue",
      "Landry", "Thierry", "Arnaud", "Blaise", "Herve", "Francis", "Achille", "Armel",
      "Aurelien", "Bertrand", "Boris", "Brice", "Christian", "Clinton", "Didier", "Emile",
      "Eric", "Ernest", "Fabrice", "Franck", "Gaston", "Georges", "Gilbert", "Guy",
      "Joel", "Junior", "Ludovic", "Marcel", "Martial", "Michel", "Narcisse", "Raoul",
      "Yannick", "Cedric", "Emmanuel", "Gerard", "Jonathan", "Maxime", "Nicolas", "Olivier",
      "Romain", "Sebastien", "Vincent", "Wilfried", "Damien", "Guillaume", "Hugues", "Kevin",
      "Laurent", "Norbert", "Pascal", "Rene", "Stephane", "Tristan", "Ulrich", "Valery",
      "Xavier", "Yves", "Clement", "Denis", "Etienne", "Florent", "Gilles", "Henri",
      "Ivan", "Julien", "Lucien", "Noel", "Prosper",
    ],
    last: [
      "Mbarga", "Fotso", "Kamga", "Ngono", "Essomba", "Owona", "Atangana", "Etoundi",
      "Mballa", "Ndongo", "Tsafack", "Djoum", "Bekono", "Manga", "Abanda", "Amougou",
      "Ateba", "Bela", "Ebang", "Ekani", "Elong", "Essono", "Eyong", "Fokou",
      "Fongang", "Kemajou", "Kome", "Mbah", "Mbida", "Mengue", "Momo", "Nana",
      "Ndam", "Ndjock", "Njie", "Simo", "Talla", "Tchakounte",
      "Nkoulou", "Etame", "Ondoa", "Bikoi", "Fouda", "Ngoumou", "Tchouameni", "Belinga",
      "Enow", "Guemo", "Kameni", "Ndip", "Oyongo", "Penda", "Tabi", "Wome",
      "Zambo", "Biya", "Djiya", "Ekambi", "Fai", "Ghomsi", "Kana", "Onana",
      "Pouna", "Tchoupo", "Wanko", "Zoua", "Bahanag", "Chedjou", "Doumbe", "Efila",
      "Fossouo", "Kemen", "Mandjeck", "Ngadeu", "Oum", "Salli", "Tolo", "Yanga",
      "Bebey", "Djetou", "Kounde", "Ntep",
    ],
  },
  "Ivory Coast": {
    weight: 6,
    first: [
      "Jean", "Ibrahim", "Christian", "Didier", "Souleymane", "Mamadou", "Ousmane", "Abdoulaye",
      "Bakary", "Moussa", "Seydou", "Lacina", "Abou", "Aboubacar", "Adama", "Ahmed",
      "Alassane", "Amara", "Aristide", "Armand", "Arsene", "Bruno", "Cedric", "Cheick",
      "Emmanuel", "Eric", "Franck", "Gervais", "Guy", "Hamed", "Herve", "Issouf",
      "Jonathan", "Karim", "Kouadio", "Ladji", "Lassina", "Michel", "Nicolas", "Olivier",
      "Patrice", "Roger", "Salif", "Serge", "Sylvain", "Wilfried", "Yacouba", "Zoumana",
      "Ismael", "Roland", "Sekou", "Vincent",
      "Landry", "Yannick", "Gerard", "Ludovic", "Maxime", "Patrick", "Romain", "Sebastien",
      "Thierry", "Aurelien", "Bertrand", "Damien", "Fabrice", "Guillaume", "Hugues", "Kevin",
      "Laurent", "Norbert", "Pascal", "Rene", "Stephane", "Tristan", "Ulrich", "Valery",
      "Xavier", "Yves", "Arnaud", "Blaise", "Clement", "Denis", "Etienne", "Florent",
      "Gilles", "Henri", "Ivan", "Julien", "Lucien", "Marcel", "Noel", "Prosper",
      "Raoul",
    ],
    last: [
      "Toure", "Kone", "Ouattara", "Coulibaly", "Diabate", "Kouassi", "Kouame", "Yao",
      "Konan", "Bamba", "Fofana", "Doumbia", "Aka", "Amani", "Assi", "Brou",
      "Diaby", "Diomande", "Dosso", "Kacou", "Koffi", "Kouakou", "Kouyate", "Meite",
      "Nguessan", "Sangare", "Sanogo", "Sylla", "Tanoh", "Traore", "Yapi", "Zoro",
      "Adou", "Angoua", "Beugre", "Dje", "Ehui", "Gohou", "Kanon", "Kobenan",
      "Konate", "Loua", "Nandy", "Obou", "Sekongo", "Soro", "Tape", "Yeo",
      "Kouadio", "Diarra", "Gnahore", "Silue", "Gbamin", "Lago", "Oulai", "Ake",
      "Bini", "Gadji", "Kamara", "Mande", "Niangbo", "Okou", "Sako", "Tia",
      "Zaki", "Cisse", "Djedje", "Guie", "Kessie", "Legre", "Nanga", "Ouedraogo",
      "Serey", "Zeze", "Bailly", "Kolo",
    ],
  },
  "United States": {
    weight: 6,
    first: [
      "Tyler", "Brandon", "Austin", "Jake", "Caleb", "Logan", "Mason", "Hunter",
      "Dillon", "Chase", "Cody", "Trevor", "Aidan", "Blake", "Brady", "Bryce",
      "Carson", "Colton", "Connor", "Dalton", "Drew", "Ethan", "Garrett", "Grant",
      "Hayden", "Jared", "Jaxon", "Jordan", "Josh", "Kyle", "Landon", "Levi",
      "Mitchell", "Nolan", "Parker", "Preston", "Riley", "Shane", "Spencer", "Tanner",
      "Weston", "Gio", "Sergino", "Yunus", "Brenden", "Cameron", "Malik", "Ricardo",
      "Auston", "Bryan", "Caden", "Dante", "Emerson", "Gage", "Kaleb", "Owen",
      "Quentin", "Reid", "Sawyer", "Vaughn", "Wyatt", "Xander", "Zane", "Ashton",
      "Dawson", "Easton", "Finley", "Grayson", "Holden", "Isaiah", "Jaden", "Kyler",
      "Lincoln", "Maddox", "Nash", "Oakley", "Rowan", "Silas", "Tucker", "Uriah",
      "Zander", "Bennett", "Camden",
    ],
    last: [
      "Miller", "Davis", "Anderson", "Thompson", "Martin", "Garcia", "Martinez", "Hernandez",
      "Jackson", "Brooks", "Sullivan", "Bennett", "Bailey", "Barnes", "Bell", "Bryant",
      "Butler", "Carter", "Coleman", "Cooper", "Cox", "Foster", "Gonzalez", "Gray",
      "Griffin", "Hayes", "Henderson", "Hughes", "Jenkins", "Kelly", "Morgan", "Murphy",
      "Myers", "Nelson", "Perry", "Peterson", "Powell", "Ramirez", "Reed", "Rivera",
      "Ross", "Russell", "Sanders", "Simmons", "Stewart", "Ward", "Watson", "Wright",
      "Smith", "Johnson", "Williams", "Brown", "Jones", "Rodriguez", "Lopez", "Wilson",
      "Thomas", "Taylor", "Moore", "Lee", "Perez", "White", "Harris", "Sanchez",
      "Clark", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Scott",
      "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Baker", "Hall",
      "Campbell", "Mitchell", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz",
      "Parker",
    ],
  },
  Switzerland: {
    weight: 5,
    first: [
      "Luca", "Noah", "Leon", "Nico", "Jan", "Fabio", "Silvan", "Joel",
      "Dario", "Marco", "Sandro", "Livio", "Adrian", "Andrin", "Benjamin", "Cedric",
      "Christian", "Daniel", "David", "Elia", "Fabian", "Florian", "Gian", "Gregor",
      "Kevin", "Lars", "Loris", "Lukas", "Manuel", "Mario", "Martin", "Nevio",
      "Pascal", "Patrick", "Remo", "Reto", "Robin", "Simon", "Timo", "Yannick",
      "Liam", "Matteo", "Elias", "Julian", "Nino", "Gabriel", "Samuel", "Aaron",
      "Emil", "Hannes", "Ivan", "Janick", "Nicola", "Olivier", "Urs", "Valentin",
      "Yves", "Bruno", "Claudio", "Damian", "Enzo", "Flavio", "Gilles", "Heinz",
      "Ilir", "Kilian", "Mirco", "Patrik", "Thierry", "Vito", "Werner", "Beat",
      "Curdin", "Diego",
    ],
    last: [
      "Meier", "Muller", "Keller", "Huber", "Schneider", "Weber", "Baumann", "Frei",
      "Brunner", "Steiner", "Widmer", "Bianchi", "Ackermann", "Berger", "Bosshard", "Burri",
      "Egger", "Fischer", "Furrer", "Gerber", "Graf", "Gut", "Hofer", "Hug",
      "Kaufmann", "Koch", "Lehmann", "Lutz", "Marti", "Moser", "Roth", "Schmid",
      "Sigrist", "Studer", "Suter", "Tanner", "Vogel", "Wenger", "Zeller", "Zuber",
      "Meyer", "Zimmermann", "Wyss", "Bucher", "Bachmann", "Egli", "Kunz", "Ammann",
      "Hess", "Sutter", "Zurcher", "Rossi", "Ferrari", "Colombo", "Fontana", "Bernasconi",
      "Favre", "Dubois", "Perret", "Rochat", "Blanc", "Chevalier", "Girard", "Jaquet",
      "Monnier", "Nicolet", "Pittet", "Ruedi", "Simon", "Tissot", "Vallotton", "Aebi",
    ],
  },
  Japan: {
    weight: 5,
    first: [
      "Haruto", "Yuto", "Sota", "Ren", "Kaito", "Daiki", "Riku", "Kenta",
      "Shota", "Yuki", "Hiroto", "Kazuki", "Aoi", "Asahi", "Daichi", "Eiji",
      "Fuma", "Hayato", "Hinata", "Ichiro", "Jun", "Kaede", "Keita", "Kenji",
      "Kosei", "Makoto", "Masaki", "Naoki", "Ryo", "Ryota", "Satoshi", "Sho",
      "Sora", "Taiga", "Takumi", "Tatsuya", "Tomoya", "Yamato", "Yusuke", "Yuya",
      "Yuma", "Itsuki", "Minato", "Aoto", "Shohei", "Keisuke", "Koki", "Rikuto",
      "Souta", "Akira", "Eita", "Gaku", "Issei", "Jin", "Kohei", "Manabu",
      "Nobu", "Osamu", "Rei", "Shin", "Wataru", "Yuji", "Noboru", "Toru",
      "Hideo", "Isamu",
    ],
    last: [
      "Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Yamamoto", "Nakamura", "Kobayashi",
      "Kato", "Yoshida", "Yamada", "Sasaki", "Abe", "Aoki", "Fujii", "Fujita",
      "Goto", "Hasegawa", "Hayashi", "Ikeda", "Inoue", "Ishii", "Ito", "Kimura",
      "Kondo", "Maeda", "Matsumoto", "Mori", "Murakami", "Nakajima", "Ogawa", "Okada",
      "Ono", "Saito", "Sakamoto", "Shimizu", "Takeda", "Ueda", "Yamaguchi", "Yamashita",
      "Yamazaki", "Hashimoto", "Ishikawa", "Endo", "Ota", "Kaneko", "Nishimura", "Fukuda",
      "Miura", "Takeuchi", "Okamoto", "Matsuda", "Harada", "Nakano", "Tamura", "Wada",
      "Ishida",
    ],
  },
  "South Korea": {
    weight: 5,
    first: [
      "Min-jun", "Ji-hoon", "Dong-hyun", "Hyun-woo", "Ji-ho", "Jun-seo", "Seung-min", "Woo-jin",
      "Tae-yang", "Ye-jun", "Do-yun", "Si-woo", "Dong-wook", "Hyun-jun", "Jae-min", "Jin-woo",
      "Joon-ho", "Ji-woo", "Kyung-ho", "Min-seok", "Sang-hyun", "Seo-jun", "Sung-min", "Yoon-ho",
      "Minjun", "Seojun", "Doyun", "Siwoo", "Hajun", "Jiho", "Yejun", "Junwoo",
      "Junseo", "Geonwoo", "Woojin", "Sunwoo", "Jiwon", "Hyunwoo", "Seongmin", "Jaewon",
      "Taeyang", "Donghyun", "Kyungho", "Sangmin", "Youngjun", "Chanwoo", "Jinwoo", "Hoyeon",
      "Namgil", "Sejin", "Byungho", "Cheolsu", "Daehyun", "Euijin", "Gicheol", "Hansol",
      "Ilseong", "Jonghyun", "Kwangmin", "Myungsoo", "Namjoon", "Ohsung", "Pilsung", "Sangwoo",
      "Taehyun", "Wonshik", "Yohan", "Jungsoo", "Kihoon", "Minseok", "Nayoung", "Sungjin",
      "Youngchul", "Bumsoo", "Dongwook", "Gunwoo", "Hyeonjun", "Jaehyun", "Kyusung", "Sangjin",
    ],
    last: [
      "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon",
      "Jang", "Lim", "Han", "Oh", "Ahn", "Bae", "Hong", "Hwang",
      "Jeon", "Ko", "Kwon", "Moon", "Nam", "Seo", "Shin", "Song",
      "Yoo", "Son", "Yang", "Baek", "Heo", "Noh", "Ryu", "Sim",
      "Won", "Chu", "Do", "Eom", "Gil", "Ha", "In", "Ji",
      "Ku", "Min", "Pyo", "Sung", "Tak", "Wi", "Yeo", "Chae",
      "Gwak", "Jin", "Ma", "Ok", "Pi", "Suk", "Uhm", "Woo",
    ],
  },
  Austria: {
    weight: 4,
    first: [
      "Lukas", "Tobias", "Florian", "Simon", "Elias", "Julian", "Matthias", "Paul",
      "Jonas", "Felix", "Alexander", "Andreas", "Christoph", "Clemens", "Daniel", "David",
      "Dominik", "Fabian", "Gernot", "Hannes", "Johannes", "Josef", "Klaus", "Konrad",
      "Leopold", "Manuel", "Markus", "Martin", "Michael", "Patrick", "Philipp", "Rainer",
      "Sebastian", "Stefan", "Thomas", "Valentin", "Werner", "Wolfgang",
      "Maximilian", "Moritz", "Raphael", "Bernhard", "Emanuel", "Gregor", "Ingo", "Nikolaus",
      "Oliver", "Ulrich", "Alois", "Benedikt", "Christian", "Erwin", "Franz", "Georg",
      "Hubert", "Johann", "Karl", "Ludwig", "Norbert", "Otto", "Peter", "Reinhard",
      "Siegfried", "Anton",
    ],
    last: [
      "Gruber", "Huber", "Bauer", "Wagner", "Pichler", "Steiner", "Moser", "Mayer",
      "Hofer", "Leitner", "Aigner", "Berger", "Brunner", "Ebner", "Eder", "Egger",
      "Fuchs", "Haas", "Haider", "Hofmann", "Holzer", "Kern", "Koller", "Lang",
      "Lechner", "Maier", "Neubauer", "Pfeifer", "Reiter", "Riegler", "Schmid", "Schwarz",
      "Stadler", "Wallner", "Weber", "Wimmer", "Winkler", "Zeller",
      "Muller", "Fischer", "Schneider", "Mayr", "Schmidt", "Baumgartner", "Auer", "Binder",
      "Wolf", "Lehner", "Schuster", "Bruckner", "Danner", "Feldmann", "Gasser", "Jung",
      "Loibl", "Neumann", "Ortner", "Prinz", "Riedl", "Sailer", "Trojer", "Url",
      "Vogl",
    ],
  },
  "Czech Republic": {
    weight: 4,
    first: [
      "Jan", "Jakub", "Tomas", "Adam", "Matej", "Ondrej", "Filip", "Vojtech",
      "Dominik", "Lukas", "Daniel", "David", "Jaroslav", "Jiri", "Josef", "Karel",
      "Marek", "Martin", "Michal", "Milan", "Miroslav", "Patrik", "Pavel", "Petr",
      "Radek", "Roman", "Vaclav", "Zdenek",
      "Stanislav", "Bohumil", "Ctirad", "Dalibor", "Emil", "Frantisek", "Gustav", "Hynek",
      "Ivo", "Jindrich", "Ladislav", "Miloslav", "Norbert", "Oldrich", "Premysl", "Radim",
      "Svatopluk", "Tibor", "Vilem", "Zbynek", "Alois", "Bedrich", "Cyril", "Eduard",
      "Havel", "Ignac", "Jaromir", "Kamil", "Lubos", "Metodej", "Otakar", "Rostislav",
      "Silvestr", "Teodor", "Vladan", "Zikmund", "Borivoj", "Cenek", "Drahomir", "Evzen",
      "Ferdinand", "Hugo", "Ivan",
    ],
    last: [
      "Novak", "Svoboda", "Novotny", "Dvorak", "Cerny", "Prochazka", "Kucera", "Vesely",
      "Horak", "Nemec", "Benes", "Blazek", "Cermak", "Dolezal", "Fiala", "Havlicek",
      "Kolar", "Kopecky", "Kral", "Mares", "Pokorny", "Pospisil", "Ruzicka", "Sedlacek",
      "Simek", "Stastny", "Urban", "Vlcek",
      "Marek", "Hajek", "Jelinek", "Zeman", "Navratil", "Vanek", "Blaha", "Kratochvil",
      "Bartos", "Polak", "Musil", "Stepanek", "Konecny", "Malek", "Holub", "Cech",
      "Soukup", "Rychly", "Bures", "Machacek", "Kriz", "Beran", "Liska", "Vavra",
      "Kadlec", "Tichy", "Sykora", "Riha", "Moravec", "Bednar", "Janda",
    ],
  },
  Turkey: {
    weight: 4,
    first: [
      "Emre", "Mert", "Can", "Efe", "Yusuf", "Ahmet", "Mehmet", "Mustafa",
      "Umut", "Berkay", "Burak", "Serkan", "Onur", "Kaan", "Deniz", "Baris",
      "Cem", "Kerem", "Eren", "Arda", "Ali", "Hasan", "Huseyin", "Ibrahim",
      "Ismail", "Osman", "Murat", "Fatih", "Halil", "Ramazan", "Recep", "Suleyman",
      "Yasin", "Bilal", "Furkan", "Enes", "Emirhan", "Kadir", "Okan", "Sinan",
      "Tolga", "Tarik", "Volkan", "Yigit", "Alper", "Aykut", "Bugra", "Caner",
      "Cihan", "Ertugrul", "Ferhat", "Gokhan", "Hakan", "Ilker", "Kemal", "Levent",
      "Metin", "Oguz", "Ozan", "Sercan", "Selim", "Semih", "Taner", "Tugay",
      "Ugur", "Veli", "Yavuz", "Zafer", "Abdullah", "Adem", "Alican", "Batuhan",
      "Berat", "Berk", "Cagatay", "Dogukan", "Ekrem", "Emin", "Ercan", "Erdem",
      "Erkan", "Ferdi", "Gokay", "Hamza", "Harun", "Ilhan", "Kagan", "Koray",
      "Orhan", "Salih", "Sefa", "Serdar", "Tayfun", "Yakup",
    ],
    last: [
      "Yilmaz", "Kaya", "Demir", "Celik", "Sahin", "Yildirim", "Ozturk", "Aydin",
      "Arslan", "Dogan", "Kilic", "Aslan", "Cetin", "Kara", "Koc", "Kurt",
      "Ozdemir", "Simsek", "Korkmaz", "Ozkan", "Yildiz", "Sen", "Bulut", "Avci",
      "Aksoy", "Tekin", "Kaplan", "Duman", "Ates", "Bozkurt", "Cinar", "Uysal",
      "Tas", "Gunes", "Akbas", "Karaca", "Sari", "Kocak", "Bilgin", "Yalcin",
      "Sezer", "Yucel", "Ozer", "Balci", "Guven", "Cakir", "Bayram", "Altun",
      "Basaran", "Coskun", "Demirci", "Dinc", "Erol", "Genc", "Gul", "Kahraman",
      "Karabulut", "Kartal", "Keskin", "Kilinc", "Kose", "Kucuk", "Mutlu", "Oz",
      "Ozbek", "Ozgur", "Saglam", "Sanli", "Savas", "Sonmez", "Soylu", "Tan",
      "Tunc", "Ucar", "Ulusoy", "Unal", "Uzun", "Varol", "Yaman", "Yesil",
      "Yorulmaz", "Akgul", "Bal", "Cakmak", "Elmas", "Ergin", "Fidan", "Guzel",
      "Kandemir", "Ozsoy", "Sarikaya", "Tuncel", "Akyol", "Bayrak", "Dursun", "Turgut",
    ],
  },
  Algeria: {
    weight: 3,
    first: [
      "Mohamed", "Amine", "Yacine", "Sofiane", "Bilal", "Walid", "Karim", "Rayan",
      "Adel", "Farid", "Abdelkader", "Ahmed", "Ali", "Anis", "Bachir", "Brahim",
      "Djamel", "Fares", "Hamza", "Hicham", "Ilyes", "Islam", "Ismail", "Kamel",
      "Khaled", "Lounis", "Mahdi", "Mehdi", "Mourad", "Nabil", "Nadir", "Omar",
      "Rachid", "Reda", "Redouane", "Riad", "Sami", "Samir", "Tarek", "Youcef",
      "Mahmoud", "Mostafa", "Amr", "Sherif", "Wael", "Hazem", "Ayman", "Bassem",
      "Fady", "Gamal", "Hesham", "Kareem", "Magdy", "Nader", "Osama", "Ramy",
      "Sameh", "Tamer", "Waleed", "Yasser", "Zakaria", "Bahaa", "Emad", "Fathi",
      "Hany", "Ihab", "Mounir", "Raafat", "Salah", "Wagdy", "Yehia", "Abdelrahman",
      "Essam", "Hamdi", "Loai", "Medhat", "Nasser", "Rashad", "Sabry", "Talaat",
      "Wesam", "Zeyad", "Anwar", "Diaa", "Galal", "Hussam",
    ],
    last: [
      "Benali", "Bouazza", "Cherif", "Hamdi", "Meziane", "Belkacem", "Saadi", "Mansouri",
      "Kaci", "Djebbar", "Abdelli", "Aissaoui", "Amrani", "Belaid", "Belhadj", "Benamara",
      "Benmoussa", "Bensalah", "Berkane", "Boudiaf", "Boukhalfa", "Boumediene", "Chaib", "Dahmani",
      "Guendouz", "Haddad", "Kadri", "Khelifi", "Lakhdar", "Larbi", "Madani", "Mebarki",
      "Mokhtari", "Ouali", "Rahmani", "Taleb", "Yahia", "Ziani",
      "Boudjemaa", "Ferhat", "Guerrouj", "Hamidi", "Idir", "Nait", "Saidi", "Yousfi",
      "Zerrouki", "Chergui", "Daoud", "Fellah", "Ghezzal", "Hamlaoui", "Iken", "Lounis",
      "Medjani", "Nekkache", "Ouchen", "Rabehi", "Sahraoui", "Tounsi", "Yahiaoui", "Zeghdoud",
      "Aissa", "Chibane", "Derradji", "Fergani", "Hammar", "Ilyes", "Kherbache", "Louanchi",
      "Merabet", "Noureddine", "Ould", "Rezki", "Slimane", "Tahar", "Yacine", "Zidane",
      "Ammour", "Bounedjah",
    ],
  },
  Morocco: {
    weight: 3,
    first: [
      "Mohamed", "Youssef", "Omar", "Anas", "Hamza", "Ayoub", "Zakaria", "Ilias",
      "Reda", "Badr", "Abdellah", "Abderrahim", "Adam", "Adil", "Ahmed", "Amine",
      "Anouar", "Aymane", "Bilal", "Brahim", "Driss", "Fouad", "Hakim", "Hamid",
      "Hassan", "Hicham", "Ibrahim", "Idriss", "Ismail", "Jamal", "Karim", "Khalid",
      "Marouane", "Mehdi", "Mounir", "Mourad", "Nabil", "Oussama", "Rachid", "Redouane",
      "Said", "Salim", "Samir", "Sofiane", "Soufiane", "Tarik", "Walid", "Yassine",
      "Younes", "Zouhair", "Nordine", "Rida",
      "Mahmoud", "Mostafa", "Tarek", "Amr", "Sherif", "Wael", "Hazem", "Ayman",
      "Bassem", "Fady", "Gamal", "Hesham", "Islam", "Kareem", "Magdy", "Nader",
      "Osama", "Ramy", "Sameh", "Tamer", "Waleed", "Yasser", "Adel", "Bahaa",
      "Emad", "Fathi", "Hany", "Ihab", "Khaled", "Raafat", "Salah", "Wagdy",
      "Yehia", "Abdelrahman", "Essam", "Farid", "Hamdi", "Loai", "Medhat", "Nasser",
      "Rashad", "Sabry", "Talaat", "Wesam", "Zeyad", "Anwar", "Diaa", "Galal",
      "Hussam",
    ],
    last: [
      "Alaoui", "Benjelloun", "El Amrani", "Tazi", "Berrada", "Chraibi", "El Idrissi", "Bennani",
      "Lahlou", "Sebti", "Abdellaoui", "Amrani", "Belhaj", "Bennis", "Boukhari", "Bouzid",
      "Chakir", "Cherkaoui", "Daoudi", "El Fassi", "El Khattabi", "El Mansouri", "Ennaji", "Essaidi",
      "Ghali", "Hajji", "Hamdaoui", "Idrissi", "Kabbaj", "Karimi", "Lamrani", "Marzouki",
      "Mekouar", "Naciri", "Ouazzani", "Rachidi", "Saidi", "Sekkat", "Slaoui", "Tahiri",
      "Tounsi", "Zaidi", "Zeroual", "Benkirane", "Bourkia", "El Ouafi", "Hilali", "Jebbour",
      "Moujahid", "Nassiri", "Sabri", "Talbi",
      "Fassi", "Guessous", "Hakimi", "Wahbi", "Yacoubi", "Zniber", "Elmoutawakil", "Fahmi",
      "Ghanem", "Iraqi", "Kettani", "Laraki", "Mansouri", "Nejjar", "Ouali", "Rifai",
      "Sbai", "Yassine", "Zouhair", "Ammar", "Bouazza", "Chaoui", "Dahbi", "Elharti",
      "Filali", "Guerraoui", "Kadiri", "Nouri", "Regragui", "Sqalli",
    ],
  },
  Senegal: {
    weight: 3,
    first: [
      "Mamadou", "Ousmane", "Abdoulaye", "Cheikh", "Ibrahima", "Modou", "Pape", "Serigne",
      "Aliou", "Babacar", "Alioune", "Amadou", "Assane", "Bacary", "Baye", "Bocar",
      "Boubacar", "Daouda", "Demba", "Djibril", "El Hadji", "Fallou", "Falilou", "Gora",
      "Habib", "Ibou", "Idrissa", "Insa", "Issa", "Khadim", "Lamine", "Malick",
      "Mansour", "Massamba", "Moctar", "Mouhamed", "Moussa", "Moustapha", "Ndiaga", "Omar",
      "Ousseynou", "Pathe", "Saliou", "Samba", "Seydou", "Sidy", "Souleymane", "Tapha",
      "Thierno", "Waly", "Yankhoba", "Youssou",
      "Serge", "Didier", "Herve", "Landry", "Yannick", "Cedric", "Emmanuel", "Franck",
      "Gerard", "Jonathan", "Ludovic", "Maxime", "Nicolas", "Olivier", "Patrick", "Romain",
      "Sebastien", "Thierry", "Vincent", "Wilfried", "Aurelien", "Bertrand", "Christian", "Damien",
      "Eric", "Fabrice", "Guillaume", "Hugues", "Jean", "Kevin", "Laurent", "Michel",
      "Norbert", "Pascal", "Rene", "Stephane", "Tristan", "Ulrich", "Valery", "Xavier",
      "Yves", "Arnaud", "Blaise", "Clement", "Denis", "Etienne", "Florent", "Gilles",
      "Henri", "Ivan", "Julien", "Lucien", "Marcel", "Noel", "Prosper", "Raoul",
    ],
    last: [
      "Ndiaye", "Diop", "Fall", "Gueye", "Sy", "Ba", "Faye", "Sarr",
      "Niang", "Diouf", "Cisse", "Mbaye", "Seck", "Thiam", "Sow", "Camara",
      "Diallo", "Sane", "Ndoye", "Badji", "Coly", "Diatta", "Goudiaby", "Samb",
      "Tine", "Dieng", "Diagne", "Kane", "Wade", "Balde", "Diedhiou", "Ndao",
      "Mendy", "Sonko", "Toure", "Traore", "Ka", "Lo", "Gaye", "Bakhoum",
      "Sembene", "Dabo", "Boye", "Ndir", "Diack", "Mbengue", "Basse", "Ndour",
      "Ngom", "Sagna",
      "Gassama", "Kebe", "Gomis", "Kouyate", "Mane", "Sylla", "Konate", "Sene",
      "Tall", "Gning", "Manga", "Bodian", "Diakhate", "Keita", "Mbodj", "Ndaw",
      "Sidibe",
    ],
  },
  Mexico: {
    weight: 3,
    first: [
      "Jose", "Luis", "Juan", "Carlos", "Jorge", "Miguel", "Fernando", "Ricardo",
      "Eduardo", "Alejandro", "Angel", "Antonio", "Cesar", "Daniel", "Diego", "Emiliano",
      "Francisco", "Gerardo", "Hector", "Javier", "Manuel", "Oscar", "Pedro", "Sergio",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Maximiliano", "Joaquin", "Benjamin", "Facundo",
      "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas", "Julian",
      "Federico", "Gonzalo", "Rodrigo", "Alonso", "Cristobal", "Esteban", "Fabian", "Gustavo",
      "Hernan", "Ivan", "Leandro", "Marcelo", "Nahuel", "Octavio", "Pablo", "Ramiro",
      "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio",
      "Ciro", "Damian", "Efrain", "Fermin", "Horacio", "Isidro", "Jonatan", "Lucio",
      "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin", "Cuauhtemoc", "Xavier", "Everardo",
      "Rigoberto",
    ],
    last: [
      "Hernandez", "Garcia", "Martinez", "Lopez", "Gonzalez", "Rodriguez", "Sanchez", "Ramirez",
      "Cruz", "Vargas", "Aguilar", "Alvarado", "Bautista", "Castaneda", "Chavez", "Contreras",
      "Delgado", "Espinoza", "Guzman", "Juarez", "Mendoza", "Ortega", "Reyes", "Rosales",
      "Perez", "Flores", "Gomez", "Morales", "Vazquez", "Jimenez", "Torres", "Diaz",
      "Gutierrez", "Ruiz", "Ortiz", "Moreno", "Castillo", "Romero", "Alvarez", "Rivera",
      "Rojas", "Salazar", "Vega", "Cortes", "Estrada", "Fuentes", "Herrera", "Ibarra",
      "Lara", "Medina", "Navarro", "Ochoa", "Padilla", "Quintero", "Rangel", "Sandoval",
      "Trejo", "Urbina", "Valdez", "Zamora", "Carrillo", "Dominguez", "Escobedo", "Figueroa",
      // Deepened when Mexico became a home league.
      "Arellano", "Barragan", "Cervantes", "Duran", "Escalante", "Galindo", "Hinojosa", "Lozano",
      "Montes", "Nunez", "Olvera", "Pacheco", "Robles", "Solis", "Tapia", "Villanueva",
      "Zavala", "Beltran",
    ],
  },
  Canada: {
    weight: 2,
    first: [
      "Liam", "Ethan", "Noah", "Owen", "Lucas", "Nathan", "Cole", "Carter",
      "Evan", "Tristan", "Alexandre", "Andrew", "Benjamin", "Braden", "Connor", "Dylan",
      "Felix", "Gabriel", "Jacob", "Mathieu", "Nolan", "Ryan", "Samuel", "Zachary",
      "Oliver", "William", "Henry", "Theodore", "Jack", "Levi", "Alexander", "Sebastian",
      "Leo", "Mateo", "Luca", "Hudson", "Emmett", "Isaac", "Kayden", "Logan",
      "Miles", "Oscar", "Parker", "Quinn", "Ryder", "Vincent", "Wyatt", "Xavier",
      "Adam", "Blake", "Caleb", "Declan", "Elliot", "Finn", "Grayson", "Hayden",
      "Ian", "Jonah", "Kai", "Landon", "Maxime", "Olivier", "Pierre", "Remi",
      "Simon", "Tyler",
    ],
    last: [
      "Tremblay", "Roy", "Gagnon", "MacLeod", "Fraser", "Bouchard", "Cote", "Morin",
      "Leblanc", "Ross", "Beaulieu", "Bergeron", "Campbell", "Cloutier", "Desjardins", "Gauthier",
      "Girard", "Lavoie", "Lefebvre", "Levesque", "Ouellet", "Paquette", "Pelletier", "Thibault",
      "Smith", "Brown", "Martin", "Lee", "Wilson", "Johnson", "MacDonald", "Taylor",
      "Anderson", "Jones", "Williams", "Miller", "Thompson", "Fortin", "Belanger", "Simard",
      "Boucher", "Caron", "Dubois", "Poirier", "Fournier", "Nadeau", "Lachance", "Bedard",
      "Michaud", "Turcotte", "Hebert", "Charbonneau", "Rousseau", "Lemieux", "Dionne", "Grenier",
      "Perron", "Vachon", "Bissonnette", "Cormier",
    ],
  },
  Australia: {
    weight: 2,
    first: [
      "Lachlan", "Cooper", "Riley", "Mitchell", "Brayden", "Zac", "Jayden", "Flynn",
      "Bailey", "Angus", "Archie", "Beau", "Callum", "Darcy", "Declan", "Ethan",
      "Hamish", "Harrison", "Jarrod", "Kai", "Liam", "Oscar", "Toby", "Xavier",
      "Jackson", "Hunter", "Logan", "Mason", "Jasper", "Hudson", "Jett", "Levi",
      "Max", "Nate", "Patrick", "Reece", "Spencer", "Zane", "Eli", "Finn",
      "Harvey", "Isaac", "Jaxon", "Koby", "Marcus", "Nash", "Owen", "Rhys",
      "Seth", "Tate", "Tyson", "Wade", "Blake", "Brodie", "Casey", "Dane",
      "Ellis", "Grant", "Heath", "Kane", "Nathan", "Rory",
    ],
    last: [
      "Kennedy", "O'Neill", "Marsh", "Hughes", "Fitzgerald", "Watson", "Nash", "Payne",
      "Draper", "Sutton", "Barrett", "Cameron", "Cross", "Doyle", "Ferguson", "Gallagher",
      "Hayward", "Lucas", "Mackay", "Newman", "Pratt", "Quinn", "Rankin", "Whitfield",
      "Smith", "Jones", "Williams", "Brown", "Wilson", "Taylor", "Johnson", "White",
      "Martin", "Anderson", "Thompson", "Nguyen", "Ryan", "Walker", "Harris", "Lee",
      "Robinson", "Kelly", "King", "Hall", "Young", "Wright", "Green", "Baker",
      "Adams", "Nelson", "Hill", "Campbell", "Mitchell", "Roberts", "Carter", "Phillips",
      "Evans", "Turner", "Parker", "Collins", "Edwards", "Stewart", "Morris", "Murphy",
      "Cook", "Rogers", "Morgan", "Bell", "Bailey", "Cooper", "Richardson", "Cox",
      "Howard", "Ward", "Peterson", "Gray", "James", "Brooks",
    ],
  },
  Finland: {
    weight: 2,
    first: [
      "Onni", "Eetu", "Aleksi", "Ville", "Juho", "Niko", "Samu", "Arttu",
      "Joona", "Elias", "Antti", "Eero", "Emil", "Henri", "Jaakko", "Janne",
      "Jere", "Joel", "Kalle", "Lauri", "Matias", "Mikko", "Otto", "Rasmus",
      "Eino", "Vaino", "Toivo", "Miro", "Niilo", "Aarne", "Veeti", "Mikael",
      "Oskari", "Santeri", "Tuomas", "Hannu", "Markus", "Olavi", "Pekka", "Risto",
      "Sami", "Tapio", "Urho", "Valtteri", "Yrjo", "Esa", "Heikki", "Ilkka",
      "Jarkko", "Kimmo", "Matti", "Olli", "Petri", "Reijo", "Seppo", "Timo",
      "Vesa", "Aki", "Erkki", "Harri", "Juha", "Kari", "Mika", "Pasi",
      "Raimo", "Teemu", "Tero", "Jussi",
    ],
    last: [
      "Korhonen", "Virtanen", "Makinen", "Nieminen", "Hamalainen", "Laine", "Heikkinen", "Koskinen",
      "Jarvinen", "Lehtonen", "Aalto", "Ahonen", "Halonen", "Hiltunen", "Kallio", "Karjalainen",
      "Lahti", "Leppanen", "Mattila", "Ojala", "Rantanen", "Saarinen", "Salminen", "Turunen",
      "Makela", "Lehtinen", "Heinonen", "Niemi", "Heikkila", "Kinnunen", "Salonen", "Salo",
      "Laitinen", "Tuominen", "Jokinen", "Savolainen", "Lahtinen", "Rasanen", "Manninen", "Koivisto",
      "Hirvonen", "Lehto", "Pitkanen", "Aaltonen", "Miettinen", "Karppinen", "Peltonen", "Toivonen",
      "Anttila", "Kettunen", "Vainio", "Sinisalo", "Kauppinen", "Marttinen", "Nurmi", "Ranta",
      "Seppala",
    ],
  },
  Romania: {
    weight: 2,
    first: [
      "Andrei", "Alexandru", "Stefan", "Mihai", "Ionut", "Gabriel", "Vlad", "Darius",
      "Razvan", "Cristian", "Adrian", "Bogdan", "Catalin", "Ciprian", "Constantin", "Cosmin",
      "Daniel", "Denis", "Dragos", "Florin", "George", "Ion", "Iulian", "Marian",
      "Marius", "Nicolae", "Octavian", "Paul", "Sorin", "Valentin", "Victor", "Silviu",
      "Radu", "Emil", "Horia", "Lucian", "Ovidiu", "Robert", "Sebastian", "Tudor",
      "Anton", "Bela", "Dorin", "Eugen", "Gheorghe", "Ilie", "Laurentiu", "Mircea",
      "Petru", "Sandu", "Teodor", "Vasile", "Aurel", "Dumitru", "Grigore", "Ionel",
      "Liviu", "Nicu", "Remus", "Traian",
    ],
    last: [
      "Popescu", "Ionescu", "Popa", "Radu", "Dumitrescu", "Stan", "Stoica", "Munteanu",
      "Gheorghe", "Matei", "Barbu", "Constantinescu", "Cristea", "Diaconu", "Dinu", "Dobre",
      "Dumitru", "Enache", "Florea", "Georgescu", "Iancu", "Lazar", "Marin", "Mihailescu",
      "Neagu", "Nistor", "Oprea", "Petrescu", "Sandu", "Tudor", "Vasile", "Voicu",
      "Constantin", "Serban", "Ciobanu", "Ilie", "Iordache", "Manole", "Rusu", "Ungureanu",
      "Zaharia", "Andrei", "Balan", "Filip", "Grigore", "Hurmuz", "Iacob", "Lupu",
      "Mocanu", "Nedelcu", "Olaru", "Pana", "Simion", "Toma", "Vlad", "Anghel",
      "Bucur", "Croitoru", "Dragomir", "Nicolae",
    ],
  },
  Slovakia: {
    weight: 2,
    first: [
      "Martin", "Tomas", "Peter", "Michal", "Jakub", "Lukas", "Matus", "Samuel",
      "Adam", "Filip", "Andrej", "Dominik", "Erik", "Jan", "Juraj", "Marek",
      "Marian", "Milan", "Miroslav", "Patrik", "Pavol", "Rastislav", "Stanislav", "Vladimir",
      "Frantisek", "Gabriel", "Igor", "Kristian", "Ladislav", "Norbert", "Oliver", "Radoslav",
      "Tibor", "Zdeno", "Anton", "Boris", "Ctibor", "Dusan", "Emil", "Ferdinand",
      "Gejza", "Henrich", "Ivan", "Jozef", "Kamil", "Lubomir", "Milos", "Nikolas",
      "Ondrej", "Sebastian", "Teodor", "Vratko", "Zoltan", "Alojz", "Bohus", "Cyril",
      "Denis", "Eduard", "Fedor", "Gustav",
    ],
    last: [
      "Kovac", "Horvath", "Varga", "Toth", "Nagy", "Balaz", "Molnar", "Szabo",
      "Lukac", "Polak", "Baran", "Benko", "Gajdos", "Hudec", "Kollar", "Kral",
      "Krajci", "Lehotsky", "Mikula", "Novotny", "Ondrus", "Sedlak", "Simko", "Vlk",
      "Novak", "Hudak", "Marek", "Oravec", "Petrik", "Rusnak", "Tomko", "Uhrin",
      "Vasko", "Zeman", "Bednar", "Cerven", "Dubovsky", "Fabian", "Gasparik", "Hlavaty",
      "Ivanic", "Jurco", "Kubis", "Liptak", "Mihalik", "Nemcek", "Palko", "Repka",
      "Slota", "Trnka", "Urban", "Zilka", "Bartos", "Chovanec", "Dolinsky", "Ferko",
      "Gregor", "Holub", "Janco", "Kubica", "Macek", "Orsula", "Pavlik",
    ],
  },
  Slovenia: {
    weight: 2,
    first: [
      "Luka", "Jan", "Nejc", "Ziga", "Anze", "Tilen", "Gasper", "Rok",
      "Blaz", "Matic", "Aljaz", "Andraz", "David", "Domen", "Gregor", "Jaka",
      "Jure", "Klemen", "Marko", "Matej", "Miha", "Nik", "Primoz", "Tim",
      "Matevz", "Sandi", "Urban", "Vid", "Ales", "Bojan", "Damjan", "Erik",
      "Franc", "Igor", "Janez", "Lovro", "Nace", "Ozren", "Peter", "Rado",
      "Simon", "Tomaz", "Uros", "Vasja", "Zdravko", "Bostjan", "Ciril", "Dejan",
      "Emil", "Filip", "Grega", "Hrvoje", "Iztok", "Kristjan", "Oskar", "Patrik",
      "Robert", "Stane", "Tine", "Valter", "Zan", "Borut",
    ],
    last: [
      "Novak", "Horvat", "Krajnc", "Zupancic", "Potocnik", "Kovac", "Mlakar", "Vidmar",
      "Golob", "Turk", "Bizjak", "Bregar", "Cerar", "Hribar", "Jerman", "Kavcic",
      "Kos", "Kotnik", "Lesjak", "Pavlin", "Rozman", "Sever", "Zajc", "Zupan",
      "Kovacic", "Bozic", "Kralj", "Korosec", "Pucelj", "Tomsic", "Ursic", "Bergant",
      "Cerne", "Dolinar", "Erzen", "Fajfar", "Gorenc", "Hocevar", "Ivancic", "Klemencic",
      "Lah", "Mavric", "Nemec", "Oblak", "Pirc", "Rebernik", "Smrekar", "Trobec",
      "Vidic", "Zorko", "Bevc", "Debevec", "Fabjan", "Grum", "Hafner", "Jazbec",
      "Logar", "Marolt", "Osredkar", "Rus",
    ],
  },
  Iceland: {
    weight: 2,
    first: [
      "Jon", "Gunnar", "Bjarni", "Kristjan", "Olafur", "Einar", "Magnus", "Arnar",
      "Dagur", "Haukur", "Andri", "Ari", "Baldur", "Birkir", "Egill", "Elvar",
      "Finnur", "Gudmundur", "Hallgrimur", "Ingi", "Kari", "Sigurdur", "Stefan", "Thorir",
      "Helgi", "Jokull", "Logi", "Mar", "Njall", "Orri", "Petur", "Ragnar",
      "Snorri", "Thor", "Ulfar", "Valur", "Ymir", "Aron", "Gylfi", "Hordur",
      "Ivar", "Jonas", "Kolbeinn", "Leifur", "Mikael", "Oskar", "Palmi", "Rurik",
      "Saevar", "Trausti", "Vilhjalmur", "Asgeir", "Eirikur", "Fannar", "Grimur", "Hafsteinn",
      "Isak", "Julius", "Kjartan", "Lars", "Matthias", "Oddur",
    ],
    last: [
      "Jonsson", "Gunnarsson", "Einarsson", "Magnusson", "Olafsson", "Kristjansson", "Arnarsson", "Thorsteinsson",
      "Halldorsson", "Palsson", "Arnason", "Bjarnason", "Danielsson", "Eiriksson", "Gislason", "Gudjonsson",
      "Hafsteinsson", "Helgason", "Ingason", "Karlsson", "Petursson", "Sigurdsson", "Stefansson", "Thorarinsson",
      "Gudmundsson", "Loftsson", "Marteinsson", "Njalsson", "Orrason", "Ragnarsson", "Snorrason", "Thorsson",
      "Ulfarsson", "Valsson", "Aronsson", "Birkisson", "Dagsson", "Egilsson", "Finnsson", "Gylfason",
      "Hardarson", "Ivarsson", "Jonasson", "Kolbeinsson", "Leifsson", "Mikaelsson", "Oskarsson", "Palmason",
      "Ruriksson", "Saevarsson", "Traustason", "Vilhjalmsson", "Asgeirsson", "Baldursson", "Fannarsson", "Grimsson",
      "Isaksson", "Juliusson", "Kjartansson", "Larusson", "Matthiasson", "Oddsson", "Hannesson",
    ],
  },
  Mali: {
    weight: 2,
    first: [
      "Moussa", "Amadou", "Boubacar", "Cheick", "Seydou", "Modibo", "Souleymane", "Adama",
      "Drissa", "Mamadou", "Abdoulaye", "Alou", "Aly", "Bakary", "Bandiougou", "Bourama",
      "Daouda", "Fousseni", "Hamidou", "Ibrahim", "Issa", "Kalifa", "Karim", "Lassana",
      "Mahamadou", "Mamady", "Moctar", "Ousmane", "Salif", "Sekou", "Sidiki", "Sory",
      "Tidiane", "Yacouba", "Yaya", "Youssouf",
      "Ibrahima", "Alseny", "Djibril", "Elhadj", "Fode", "Gaoussou", "Ismaila", "Lamine",
      "Mory", "Naby", "Oumar", "Pathe", "Thierno", "Cherif", "Facinet", "Gouda",
      "Hassane", "Idrissa", "Karamoko", "Lansana", "Mohamed", "Nouhou", "Ousseynou", "Saidou",
      "Aboubacar", "Balla", "Cellou", "Diakaria", "Fanta", "Gassim", "Halimatou", "Issiaga",
      "Kabine", "Lancine", "Morlaye", "Nfaly", "Tafsir", "Vamara", "Zakaria",
    ],
    last: [
      "Traore", "Coulibaly", "Keita", "Diarra", "Sidibe", "Kone", "Doumbia", "Diallo",
      "Camara", "Sanogo", "Bagayoko", "Ballo", "Berthe", "Cisse", "Diakite", "Dicko",
      "Dolo", "Fane", "Fofana", "Guindo", "Haidara", "Kamissoko", "Konate", "Kouyate",
      "Maiga", "Malle", "Niare", "Samake", "Sangare", "Sissoko", "Sow", "Tangara",
      "Togola", "Toure", "Diakhate", "Sacko",
      "Dembele", "Kanoute", "Tounkara", "Marega", "Sylla", "Mariko", "Ouattara", "Samassekou",
      "Tamboura", "Diawara", "Guirassy", "Kanta", "Magassa", "Nimaga", "Toloba", "Bouare",
      "Djire", "Fomba", "Kassogue", "Sagara", "Tapily", "Wague", "Yalcouye", "Diakhaby",
    ],
  },
  "Burkina Faso": {
    weight: 1,
    first: [
      "Issa", "Adama", "Boureima", "Salif", "Idrissa", "Harouna", "Karim", "Zakaria",
      "Abdoul", "Alassane", "Aristide", "Bakary", "Bertrand", "Cyrille", "Drissa", "Hamado",
      "Herve", "Ibrahim", "Lassina", "Moussa", "Ousmane", "Rasmane", "Seydou", "Wilfried",
      "Mamadou", "Abdoulaye", "Cheikh", "Modou", "Boubacar", "Lamine", "Amadou", "Souleymane",
      "Youssouf", "Sekou", "Aliou", "Bocar", "Demba", "Fode", "Habib", "Kalidou",
      "Malick", "Ndiaga", "Omar", "Pape", "Saliou", "Tidiane", "Yaya", "Bassirou",
      "Cherif", "Djibril", "Elhadji", "Fallou", "Gora", "Hamidou", "Insa", "Jules",
      "Khadim", "Landing", "Mor", "Nfally", "Oumar", "Pathe", "Thierno", "Waly",
      "Yankuba", "Zale", "Baba", "Cheikhou", "Dame",
    ],
    last: [
      "Ouedraogo", "Kabore", "Sawadogo", "Zongo", "Compaore", "Nikiema", "Sanou", "Ilboudo",
      "Bado", "Bamogo", "Bance", "Dabire", "Derme", "Kagone", "Kambou", "Kanazoe",
      "Konfe", "Nacoulma", "Ouattara", "Sanfo", "Sankara", "Tapsoba", "Traore", "Yameogo",
      "Bationo", "Congo", "Diallo", "Kabre", "Kone", "Zoungrana", "Guiro", "Ouali",
      "Palenfo", "Rouamba", "Tiendrebeogo", "Zerbo", "Bagagnan", "Coulibaly", "Gansore", "Kagambega",
      "Millogo", "Nabaloum", "Ouangre", "Poda", "Sama", "Tou", "Yago", "Zabsonre",
      "Bandaogo", "Dabo", "Gouba", "Minoungou", "Nignan", "Ouoba", "Porgo", "Segda",
      "Toure", "Yoda", "Zida",
    ],
  },
  "DR Congo": {
    weight: 1,
    first: [
      "Cedric", "Yannick", "Gael", "Jonathan", "Patrick", "Christian", "Glody", "Dieudonne",
      "Alain", "Arsene", "Bienvenu", "Blaise", "Cesar", "Clement", "Deo", "Elie",
      "Emmanuel", "Fabrice", "Firmin", "Franck", "Gedeon", "Herve", "Jacques", "Joel",
      "Junior", "Landry", "Marcel", "Merveille", "Nathan", "Papy", "Prince", "Tresor",
      "Chancel", "Dieumerci", "Neeskens", "Paul", "Samuel", "Ben", "Dylan", "Elia",
      "Jackson", "Kevin", "Luc", "Olivier", "Patient", "Rocky", "Simon", "Trevor",
      "Victor", "Wilfried", "Arthur", "Bakari", "Claude", "Didier", "Gladson", "Henri",
      "Isaac", "Kabongo", "Michel", "Nelson", "Omer", "Pascal", "Roger", "Serge",
      "Thierry", "Ulrich", "Vital", "William", "Yves", "Charles",
    ],
    last: [
      "Kabongo", "Ilunga", "Mukendi", "Tshibanda", "Kalonji", "Mbuyi", "Ngoy", "Kasongo",
      "Badibanga", "Bwanga", "Kabamba", "Kabuya", "Kalala", "Kalombo", "Kambala", "Kanda",
      "Kanku", "Kapinga", "Kayembe", "Lubamba", "Lumbu", "Mbala", "Mbombo", "Muamba",
      "Mulumba", "Mutombo", "Mwamba", "Ndaye", "Ngandu", "Ntumba", "Tshibola", "Tshimanga",
      "Mbemba", "Bolasie", "Bakambu", "Kabananga", "Mulumbu", "Kimuaki", "Luyindama", "Masuaku",
      "Ndombele", "Kalambay", "Lomalisa", "Mabidi", "Nsimba", "Okito", "Panzo", "Sadiki",
      "Wemba", "Bope", "Diata", "Ebonda", "Lukaku", "Ngoma", "Otepa", "Pembele",
      "Sakala", "Tumba", "Wanyama", "Bikoko", "Dianzenza", "Elonga", "Kabeya", "Lubaki",
      "Mavuba", "Nkulu", "Osango", "Pindi", "Sango", "Tshiani", "Wembo", "Bosongo",
      "Disashi", "Emonde", "Lusadisu", "Nzuzi", "Ombeni", "Poba", "Selemani", "Tshama",
      "Yabo",
    ],
  },
  Guinea: {
    weight: 1,
    first: [
      "Mohamed", "Ibrahima", "Ousmane", "Sekou", "Alseny", "Mamadi", "Fode", "Lansana",
      "Abdoulaye", "Alhassane", "Aly", "Amadou", "Boubacar", "Cheick", "Djibril", "El Hadj",
      "Ismael", "Mamadou", "Mory", "Moussa", "Saliou", "Sekouba", "Souleymane", "Thierno",
      "Yacouba", "Aboubacar", "Facinet", "Karamoko",
      "Elhadj", "Gaoussou", "Hamidou", "Ismaila", "Kalifa", "Lamine", "Naby", "Oumar",
      "Pathe", "Bakary", "Cherif", "Daouda", "Gouda", "Hassane", "Idrissa", "Nouhou",
      "Ousseynou", "Saidou", "Tidiane", "Youssouf", "Balla", "Cellou", "Diakaria", "Fanta",
      "Gassim", "Halimatou", "Issiaga", "Kabine", "Lancine", "Morlaye", "Nfaly", "Sidiki",
      "Tafsir", "Vamara", "Yaya", "Zakaria",
    ],
    last: [
      "Camara", "Sylla", "Bah", "Barry", "Conde", "Soumah", "Cisse", "Toure",
      "Bangoura", "Bangura", "Balde", "Conte", "Diakite", "Diallo", "Diane", "Doumbouya",
      "Fofana", "Kaba", "Keita", "Kourouma", "Mara", "Savane", "Sidibe", "Sow",
      "Souare", "Traore", "Yansane", "Doumbia",
      "Gueye", "Magassouba", "Nabe", "Dioubate", "Fadiga", "Guilavogui", "Haidara", "Kalabane",
      "Loua", "Niane", "Sagno", "Toumbou", "Youla", "Beavogui", "Donzo", "Fode",
      "Gassama", "Kante", "Konate", "Lamah", "Mansare", "Nasser", "Soumaoro", "Tounkara",
      "Zoumanigui", "Bantoura", "Damba", "Kolie", "Millimouno", "Sangare", "Titi", "Yattara",
    ],
  },
  Uruguay: {
    weight: 1,
    first: [
      "Santiago", "Matias", "Agustin", "Facundo", "Diego", "Bruno", "Emiliano", "Maximiliano",
      "Alejandro", "Alvaro", "Andres", "Bautista", "Camilo", "Carlos", "Cristian", "Damian",
      "Enzo", "Fabian", "Federico", "Felipe", "Fernando", "Gaston", "Gonzalo", "Guillermo",
      "Gustavo", "Ignacio", "Joaquin", "Juan", "Leandro", "Lucas", "Marcelo", "Martin",
      "Mauricio", "Nicolas", "Pablo", "Rodrigo", "Sebastian", "Tomas",
      "Mateo", "Benjamin", "Thiago", "Valentin", "Lautaro", "Julian", "Alonso", "Cristobal",
      "Esteban", "Hernan", "Ivan", "Javier", "Nahuel", "Octavio", "Ramiro", "Salvador",
      "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio", "Ciro",
      "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan", "Lucio", "Norberto",
      "Osvaldo", "Prospero", "Quintin", "Brian", "Nahitan",
    ],
    last: [
      "Perez", "Rodriguez", "Fernandez", "Gonzalez", "Silva", "Pereira", "Sosa", "Techera",
      "Acosta", "Alonso", "Alvarez", "Barrios", "Benitez", "Cabrera", "Castro", "Correa",
      "De Leon", "Diaz", "Duarte", "Garcia", "Gimenez", "Gomez", "Hernandez", "Lopez",
      "Machado", "Martinez", "Medina", "Mendez", "Olivera", "Ortiz", "Ramos", "Rivero",
      "Romero", "Sanchez", "Torres", "Vazquez", "Vera", "Viera",
      "Suarez", "Cardozo", "Da Silva", "Etcheverry", "Falero", "Izquierdo", "Lasarte", "Nunez",
      "Piriz", "Quagliata", "Rossi", "Urretaviscaya", "Zeballos", "Bentancur", "Espino", "Fuentes",
      "Invernizzi", "Larrosa", "Nandez", "Pintos", "Saravia", "Vecino", "Zunino", "Aguirre",
      "Blanco", "Cavani", "Dominguez", "Ferreira", "Gaston",
    ],
  },
  Colombia: {
    weight: 1,
    first: [
      "Juan", "Camilo", "Andres", "Santiago", "Sebastian", "Mateo", "Daniel", "Felipe",
      "Alejandro", "Carlos", "Cristian", "David", "Diego", "Edwin", "Esteban", "Fabian",
      "Jhon", "Jorge", "Julian", "Luis", "Miguel", "Nicolas", "Oscar", "Ricardo",
      "Samuel", "Sergio", "Wilmar", "Yeison",
      "Emiliano", "Maximiliano", "Joaquin", "Benjamin", "Facundo", "Thiago", "Bautista", "Valentin",
      "Lautaro", "Agustin", "Ignacio", "Tomas", "Federico", "Gonzalo", "Rodrigo", "Alonso",
      "Cristobal", "Gustavo", "Hernan", "Ivan", "Javier", "Leandro", "Marcelo", "Nahuel",
      "Octavio", "Pablo", "Ramiro", "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno",
      "Yago", "Aurelio", "Braulio", "Ciro", "Damian", "Efrain", "Fermin", "Gerardo",
      "Horacio", "Isidro", "Jonatan", "Lucio", "Mauricio", "Norberto", "Osvaldo", "Prospero",
      "Quintin", "Yerry", "Duvan",
    ],
    last: [
      "Gomez", "Restrepo", "Cardona", "Arango", "Betancur", "Salazar", "Castano", "Giraldo",
      "Acevedo", "Agudelo", "Arias", "Bedoya", "Bolanos", "Cadavid", "Correa", "Duque",
      "Escobar", "Franco", "Guerrero", "Hoyos", "Jaramillo", "Marulanda", "Mejia", "Montoya",
      "Osorio", "Palacio", "Quintero", "Rincon",
      "Rodriguez", "Gonzalez", "Martinez", "Garcia", "Lopez", "Sanchez", "Ramirez", "Torres",
      "Diaz", "Vargas", "Castro", "Ruiz", "Alvarez", "Romero", "Suarez", "Rojas",
      "Moreno", "Munoz", "Cardenas", "Henao", "Lozano", "Naranjo", "Patino", "Tobon",
      "Uribe", "Valencia", "Zapata", "Arboleda", "Cordoba", "Delgado", "Estupinan", "Fajardo",
      "Guzman", "Hurtado", "Idarraga", "Londono", "Mosquera", "Ospina", "Perea", "Renteria",
      "Sarmiento",
    ],
  },
  Ecuador: {
    weight: 1,
    first: [
      "Carlos", "Luis", "Angel", "Jefferson", "Bryan", "Kevin", "Jhon", "Darwin",
      "Alexander", "Anderson", "Byron", "Cristian", "Damian", "Diego", "Edison", "Fernando",
      "Jaime", "Joao", "Jordy", "Jose", "Marcos", "Michael", "Patricio", "Renato",
      "Ronny", "Segundo", "Washington", "Wilson",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Rodrigo", "Alonso", "Cristobal", "Esteban", "Fabian",
      "Gustavo", "Hernan", "Ivan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio",
      "Pablo", "Ramiro", "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago",
      "Aurelio", "Braulio", "Ciro", "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro",
      "Jonatan", "Lucio", "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin", "Moises",
      "Piero", "Angelo", "Jhegson",
    ],
    last: [
      "Zambrano", "Cedeno", "Mendez", "Quinonez", "Vera", "Espinoza", "Palacios", "Chila",
      "Andrade", "Arroyo", "Bone", "Carabali", "Castillo", "Cortez", "Delgado", "Guerrero",
      "Intriago", "Mina", "Montano", "Moreira", "Ordonez", "Preciado", "Solis", "Tenorio",
      "Vergara", "Zamora", "Angulo", "Bravo",
      "Mendoza", "Caicedo", "Valencia", "Alcivar", "Estupinan", "Franco", "Hurtado", "Jimenez",
      "Loor", "Macias", "Nazareno", "Ponce", "Quijano", "Rodriguez", "Solorzano", "Ulloa",
      "Vasquez", "Yepez", "Anchundia", "Bermudez", "Cabezas", "Duenas", "Erazo", "Fajardo",
      "Gruezo", "Hidalgo", "Ibarra", "Jaramillo", "Lastra", "Noboa", "Orellana", "Pinargote",
      "Quintero", "Reasco", "Sanchez", "Torres", "Vinueza", "Zapata", "Bagui",
    ],
  },
  Paraguay: {
    weight: 1,
    first: [
      "Oscar", "Victor", "Hugo", "Cesar", "Ruben", "Osvaldo", "Blas", "Adalberto",
      "Alejandro", "Antonio", "Braian", "Carlos", "Derlis", "Diego", "Fabian", "Gustavo",
      "Ivan", "Jorge", "Julio", "Luis", "Marcelo", "Nelson", "Robert", "Rodrigo",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Alonso", "Cristobal", "Esteban", "Hernan", "Javier",
      "Leandro", "Nahuel", "Octavio", "Pablo", "Ramiro", "Salvador", "Teodoro", "Ulises",
      "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio", "Ciro", "Damian", "Efrain",
      "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan", "Lucio", "Mauricio", "Norberto",
      "Prospero", "Quintin", "Cecilio", "Hernesto",
    ],
    last: [
      "Benitez", "Caceres", "Villalba", "Ayala", "Franco", "Ortiz", "Riveros", "Ruiz Diaz",
      "Aquino", "Barrios", "Bobadilla", "Cabral", "Duarte", "Escobar", "Gimenez", "Gonzalez",
      "Ledesma", "Lezcano", "Martinez", "Mendoza", "Morel", "Ovelar", "Paredes", "Samudio",
      "Ramirez", "Acosta", "Barreto", "Galeano", "Ibarra", "Jara", "Medina", "Nunez",
      "Ocampos", "Quintana", "Sanabria", "Torales", "Valdez", "Yegros", "Zarate", "Aguero",
      "Bogado", "Chamorro", "Delgado", "Espinola", "Fretes", "Godoy", "Insfran", "Leguizamon",
      "Notario", "Olmedo", "Penayo", "Recalde", "Servin", "Talavera", "Vera", "Aranda",
      "Britez", "Cardozo", "Dominguez", "Fernandez", "Gauto", "Insaurralde", "Larrosa",
    ],
  },
  Venezuela: {
    weight: 1,
    first: [
      "Jose", "Miguel", "Rafael", "Alejandro", "Jesus", "Eduardo", "Anthony", "Jhonny",
      "Alexander", "Angel", "Carlos", "Daniel", "Darwin", "Edgar", "Franklin", "Gabriel",
      "Jefferson", "Jhon", "Juan", "Luis", "Manuel", "Ricardo", "Ronald", "Wilker",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Rodrigo", "Alonso", "Cristobal", "Esteban", "Fabian",
      "Gustavo", "Hernan", "Ivan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio",
      "Pablo", "Ramiro", "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago",
      "Aurelio", "Braulio", "Ciro", "Damian", "Efrain", "Fermin", "Gerardo", "Horacio",
      "Isidro", "Jonatan", "Lucio", "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin",
      "Yeferson", "Wuilker",
    ],
    last: [
      "Blanco", "Castillo", "Rivas", "Guerra", "Paez", "Mendoza", "Colmenares", "Aponte",
      "Alvarado", "Arteaga", "Bello", "Bermudez", "Contreras", "Escalante", "Figuera", "Gil",
      "Hidalgo", "Lozano", "Marquez", "Montes", "Ortega", "Quintero", "Rojas", "Suarez",
      "Rodriguez", "Gonzalez", "Perez", "Hernandez", "Garcia", "Martinez", "Ramirez", "Sanchez",
      "Diaz", "Salazar", "Moreno", "Duarte", "Escalona", "Guerrero", "Jaimes", "Lugo",
      "Navarro", "Osorio", "Palacios", "Torrealba", "Uzcategui", "Vielma", "Yanez", "Zambrano",
      "Bracho", "Castellanos", "Delgado", "Espinoza", "Farias", "Graterol", "Herrera", "Infante",
      "Lozada", "Nieves", "Parra", "Rangel", "Silva", "Urdaneta", "Villalobos", "Zerpa",
      "Betancourt",
    ],
  },
};

/**
 * A staging table for nationalities that have a full name pool and a "home
 * league" weight, but are deliberately excluded from NATIONALITIES (and
 * therefore from totalWeight()/pickFromTable's flat, no-homeCountry draw): a
 * nation placed here can only ever be drawn via
 * pickNationality(rng, homeCountry) with that exact homeCountry — never as
 * incidental flavor in another league's roster, and never in the flat pool
 * every existing save's youth intake/free agency already relies on. This
 * keeps adding a new nationality from silently shifting the outcome
 * distribution for saves that have nothing to do with it. Graduate an entry
 * to NATIONALITIES once its home league actually exists in every save it
 * could appear in.
 *
 * Italy lived here while its home league was newer than some saves, and was
 * graduated into NATIONALITIES once every world generated an Italian league —
 * so Italians now appear abroad as ordinary foreign flavor, like Spaniards and
 * Germans.
 *
 * The current residents arrived with the Turkish league: the Super Lig's real
 * breakdown has a distinctive Balkan/West-African tail that names three nations
 * with no pool anywhere. They sit here rather than in OTHER_NATIONS on purpose
 * — TAIL_BASE is built from NATIONALITIES + OTHER_NATIONS only, so putting them
 * there would have re-weighted the "Rest of the World" tail draw for every
 * league in every existing save. Here they can only ever be drawn by the
 * Turkish table that names them explicitly. The `weight` is unused for these
 * (nothing reads UNLISTED for a flat draw); it records where they would sit if
 * they were ever graduated.
 */
export const UNLISTED_NATIONALITIES: Record<string, NationalityDef> = {
  // Every FIFA member that no shipped league's real breakdown happens to name.
  // They live here, and NOT in OTHER_NATIONS, for exactly the reason the block
  // comment above gives: TAIL_BASE is built from NATIONALITIES + OTHER_NATIONS,
  // so a nation there is drawn by every league's rest-of-world roll and would
  // change generated players in every existing save. Here they are reachable
  // only from a table that names them — which is what lets a player build, say,
  // a Taiwanese league without a hundred obscure nations leaking into the
  // Premier League's tail. Spread FIRST so a hand-curated entry below wins any
  // name collision. See src/core/players/worldNationalities.ts.
  ...WORLD_NATIONALITIES,

  // Curacao and Suriname are here for the Eredivisie, where the real breakdown
  // puts them at 1.4% each. Spelled ASCII ("Curacao", not "Curaçao") because
  // every other nationality key is, and the same anglicizing that makes Côte
  // d'Ivoire "Ivory Coast" here. Neither has flag art, so both render the
  // neutral swatch — the same call the other 15 artless nations took, and
  // better than a wrong flag.
  Curacao: {
    weight: 3,
    first: [
      "Ryan", "Kevin", "Angelo", "Roberto", "Jurgen", "Miguel", "Randy", "Shurendy",
      "Gino", "Delano", "Emilio", "Rodney", "Sherwin", "Ivan", "Rachid", "Orlando",
      "Damian", "Elton", "Ramon", "Julio", "Franklin", "Kenneth", "Marvin", "Rudolf",
      "Anthony", "Sergio", "Wendell", "Alberto", "Hendrik", "Nelson", "Vincent", "Osvaldo",
      "Kelvin", "Fernando", "Jeffrey", "Ricardo", "Armando", "Leonardo", "Mauricio", "Edwin",
      "Gerald", "Raymond", "Alfonso", "Cornelis", "Dwight", "Ernesto", "Gilbert", "Humberto",
      "Ignacio", "Joel", "Lorenzo", "Manuel", "Norman", "Patrick", "Quincy", "Rolando",
    ],
    last: [
      "Statia", "Cijntje", "Isenia", "Girigori", "Anthonia", "Nicolaas", "Wawoe", "Leito",
      "Pieternella", "Hato", "Marchena", "Palm", "Croes", "Semeleer", "Kool", "Franciscus",
      "Damascus", "Bakhuis", "Sambo", "Doran", "Rosalia", "Gumbs", "Lourens", "Willems",
      "Jansen", "Bernabela", "Cornelia", "Angela", "Constansia", "Everts", "Frans", "Godett",
      "Henriquez", "Ignacio", "Jacobs", "Koeiman", "Lopez", "Maduro", "Narvaez", "Osepa",
      "Pietersz", "Rosaria", "Sluis", "Tromp", "Ursula", "Valpoort", "Wiels", "Zimmerman",
      "Jesurun", "Pourier", "Refos", "Thode", "Vrolijk", "Felida", "Hooi", "Lasten",
    ],
  },
  // Suriname's population is Dutch, Hindustani, Javanese, Creole and Maroon,
  // and the pool spans all of them rather than picking one — a Surinamese squad
  // drawn only from Dutch surnames would read wrong.
  Suriname: {
    weight: 3,
    first: [
      "Ricardo", "Dennis", "Humphrey", "Roy", "Steven", "Marlon", "Ramon", "Glenn",
      "Clifton", "Errol", "Wensley", "Sergio", "Randy", "Gregory", "Farid", "Anand",
      "Vikash", "Rakesh", "Soerin", "Djoemadi", "Hendrik", "Wilfred", "Rudy", "Cornelis",
      "Marciano", "Delroy", "Nigel", "Ashwin", "Ravi", "Suresh", "Bhoendra", "Iwan",
      "Johan", "Ludwig", "Melvin", "Norbert", "Oscar", "Percy", "Quintin", "Robby",
      "Stanley", "Theo", "Urwin", "Vincent", "Winston", "Xavier", "Yvon", "Zachary",
      "Armand", "Benito", "Cedric", "Dwight", "Edgar", "Freddy", "Gerard", "Harold",
    ],
    last: [
      "Vriesde", "Kaersenhout", "Ramdin", "Bhagwandin", "Jharap", "Sardjoe", "Sariman",
      "Wongsodikromo", "Amoksi", "Pinas", "Sanches", "Abrahams", "Alberga", "Fernandes",
      "Gefferie", "Ilahibaks", "Jubitana", "Kartodikromo", "Leeflang", "Landveld", "Nanan",
      "Oosterling", "Pengel", "Raghoebier", "Simson", "Soekhlal", "Uiterloo", "Vlijter",
      "Wijdenbosch", "Zamuel", "Aroepa", "Codrington", "Esajas", "Findlay", "Grunberg",
      "Hindori", "Kromodimedjo", "Lieuw", "Moesetiko", "Nurmohamed", "Pawironadi", "Sitaldin",
      "Tjon", "Waterberg", "Adhin", "Alimoenadi", "Baldew", "Chotkan", "Doerga", "Elstak",
      "Ferrier", "Goedschalk", "Hiwat", "Jagernath", "Lachmon", "Panday",
    ],
  },
  "Bosnia-Herzegovina": {
    weight: 3,
    first: [
      "Amar", "Haris", "Emir", "Tarik", "Adnan", "Vedad", "Miralem", "Denis",
      "Armin", "Edin", "Adis", "Alen", "Almir", "Amel", "Anel", "Damir",
      "Dino", "Elvis", "Ermin", "Faruk", "Jasmin", "Kenan", "Mirza", "Nedim",
      "Nermin", "Samir", "Senad", "Adem",
      "Goran", "Ibrahim", "Lejla", "Muhamed", "Omer", "Rijad", "Zlatan", "Benjamin",
      "Fahrudin", "Halid", "Irfan", "Jasenko", "Kemal", "Osman", "Rasim", "Sead",
      "Toni", "Vahid", "Zijad", "Bakir", "Elvir", "Fikret", "Husein", "Izet",
      "Jusuf", "Meho", "Nihad", "Refik", "Suad", "Vahidin", "Zajko", "Almin",
      "Dzenan",
    ],
    last: [
      "Hodzic", "Begic", "Delic", "Mujic", "Salihovic", "Kovacevic", "Halilovic", "Suljic",
      "Music", "Alic", "Avdic", "Bajramovic", "Beganovic", "Dedic", "Ferhatovic", "Hadzic",
      "Husic", "Imamovic", "Jusic", "Karic", "Mehmedovic", "Omerovic", "Osmanovic", "Ramic",
      "Sarajlic", "Softic", "Tahirovic", "Zukic",
      "Cengic", "Dzafic", "Gusic", "Lulic", "Memic", "Nuhic", "Pasic", "Velic",
      "Basic", "Cosic", "Duric", "Efendic", "Fazlic", "Gazic", "Isakovic", "Jahic",
      "Kadric", "Lukic", "Mahmutovic", "Nukic", "Puric", "Rizvic", "Selimovic", "Topalovic",
      "Vukovic", "Zahirovic", "Ahmetovic", "Bektas", "Curic", "Dizdarevic", "Fejzic", "Grahovac",
    ],
  },
  Gambia: {
    weight: 2,
    first: [
      "Lamin", "Modou", "Ebrima", "Musa", "Alieu", "Ousman", "Sulayman", "Momodou",
      "Bakary", "Yankuba", "Abdoulie", "Amadou", "Assan", "Buba", "Dawda", "Foday",
      "Ismaila", "Kebba", "Malick", "Muhammed", "Omar", "Pa", "Saikou", "Sanna",
      "Ibrahim", "Mamadou", "Ousmane", "Abdoulaye", "Cheikh", "Alassane", "Boubacar", "Lamine",
      "Moussa", "Seydou", "Souleymane", "Youssouf", "Karim", "Idrissa", "Sekou", "Aliou",
      "Bocar", "Demba", "Fode", "Habib", "Issa", "Kalidou", "Ndiaga", "Pape",
      "Saliou", "Tidiane", "Yaya", "Adama", "Bassirou", "Cherif", "Djibril", "Elhadji",
      "Fallou", "Gora", "Hamidou", "Insa", "Jules", "Khadim", "Landing", "Mor",
      "Nfally", "Oumar", "Pathe", "Salif", "Thierno", "Waly", "Zale", "Baba",
      "Cheikhou", "Dame",
    ],
    last: [
      "Jallow", "Ceesay", "Touray", "Sanneh", "Bojang", "Darboe", "Camara", "Njie",
      "Sowe", "Manneh", "Badjie", "Bah", "Colley", "Conteh", "Danso", "Drammeh",
      "Fatty", "Jammeh", "Janneh", "Jarju", "Jatta", "Jobe", "Kanteh", "Sillah",
      "Gaye", "Hydara", "Loum", "Mendy", "Nyassi", "Owens", "Panneh", "Ndure",
      "Saidy", "Trawally", "Umar", "Wadda", "Yabo", "Dibba", "Faal", "Gassama",
      "Hadi", "Keita", "Lowe", "Marong", "Nyang", "Ousman", "Sabally", "Tamba",
      "Waggeh", "Barrow", "Cham", "Dampha", "Fofana", "Gomez", "Kujabi", "Minteh",
      "Njai", "Sarr", "Turay", "Ann",
    ],
  },
  Albania: {
    weight: 3,
    first: [
      "Arber", "Endrit", "Klevis", "Ardit", "Redon", "Kristi", "Erjon", "Fatjon",
      "Blerim", "Gentian", "Albion", "Altin", "Andi", "Arlind", "Armando", "Besnik",
      "Denis", "Dorian", "Elton", "Enea", "Ermal", "Florian", "Ilir", "Kreshnik",
      "Lorik", "Sokol", "Erion", "Klodian",
      "Dritan", "Flamur", "Gezim", "Jetmir", "Kujtim", "Ledio", "Marjus", "Nertil",
      "Orges", "Petrit", "Rezart", "Taulant", "Valon", "Xhevdet", "Ylli", "Agron",
      "Bledar", "Edon", "Fisnik", "Genti", "Hekuran", "Indrit", "Kastriot", "Mentor",
      "Naim", "Odise", "Prel", "Rigers", "Shkelzen", "Tomor", "Vullnet", "Xhulio",
      "Zamir", "Bujar", "Driton", "Fatos", "Gramoz",
    ],
    last: [
      "Hoxha", "Shehu", "Krasniqi", "Berisha", "Gjoka", "Prifti", "Bardhi", "Leka",
      "Zeneli", "Malaj", "Ahmeti", "Bala", "Bregu", "Cela", "Dedaj", "Dema",
      "Duka", "Gjini", "Hasani", "Kola", "Kurti", "Lala", "Marku", "Meta",
      "Muca", "Nika", "Rama", "Vata",
      "Alia", "Bushati", "Dervishi", "Elezi", "Frasheri", "Ismaili", "Jaupi", "Osmani",
      "Pashaj", "Qosja", "Sula", "Tafaj", "Ulqinaku", "Veseli", "Xhaferi", "Ymeri",
      "Zeqiri", "Basha", "Cani", "Ferraj", "Gega", "Halili", "Ibrahimi", "Jakupi",
      "Lika", "Ndoja", "Papa", "Rexha", "Salihu", "Tahiri", "Xhemali", "Ziu",
      "Balliu", "Dashi",
    ],
  },

  /* ── Reachable only by a league that names them (2026-08-26) ──────────────
   * Everything below exists so a league the player builds can be somewhere in
   * particular: a Gulf league, an east African one, an Oceanian one. They are
   * here rather than in OTHER_NATIONS for the reason this table exists at all
   * — TAIL_BASE is built from NATIONALITIES + OTHER_NATIONS, so adding thirty
   * nations there would re-weight the "Rest of the World" tail of every league
   * in every existing save. Here they are drawn only by a table that names
   * them explicitly, so the shipped world is untouched.
   *
   * `weight` is unused for UNLISTED entries (nothing reads it for a flat draw);
   * it records where they would sit if one were ever graduated.
   *
   * Names are common civilian ones, never national-team squads, so a generated
   * player can't read as a real professional. Several have no flag art yet and
   * render the neutral swatch <Flag> already falls back to. */
  "Saudi Arabia": {
    weight: 2,
    first: [
      "Abdullah", "Mohammed", "Faisal", "Khalid", "Saud", "Turki", "Nasser", "Bandar",
      "Majed", "Sultan", "Fahad", "Yousef", "Omar", "Ibrahim", "Salman", "Rayan",
      "Ziyad", "Hatim", "Anas", "Marwan", "Talal", "Waleed", "Rakan", "Badr",
      "Abdulaziz", "Abdulrahman", "Saleh", "Hamad", "Naif", "Mishal", "Fawaz", "Raed",
      "Basem", "Tamer", "Riyadh", "Mazen", "Nawaf", "Ayman", "Hisham", "Sami",
      "Adel", "Jaber", "Rashed", "Suhail", "Thamer", "Yazeed", "Zaid", "Amjad",
      "Bassam", "Dhari", "Emad", "Fares", "Ghazi", "Haitham", "Ihab", "Jamal",
      "Kamal", "Laith", "Mansour", "Nabil", "Osama", "Qusai", "Rami", "Tarek",
      "Ubaid", "Wael", "Yaser", "Zuhair", "Adnan", "Bilal", "Dawoud", "Eyad",
      "Firas", "Ghassan", "Hazem", "Issam", "Jihad", "Khalaf", "Luay",
    ],
    last: [
      "Alharbi", "Alotaibi", "Alqahtani", "Alghamdi", "Alzahrani", "Alshehri", "Aldosari", "Almutairi",
      "Alanazi", "Alsubaie", "Alamri", "Albalawi", "Alrashidi", "Aljuhani", "Alshammari", "Alfaifi",
      "Alyami", "Alkhaldi", "Alsulami", "Alhazmi", "Almalki", "Asiri", "Bahammam", "Nahdi",
      "Aldakhil", "Alshaikh", "Alsaleh", "Alnasser", "Alfahad", "Alsalem", "Alkhalil", "Alhamad",
      "Alturki", "Almousa", "Albakr", "Aldawsari", "Alharthi", "Alqurashi", "Alsahli", "Albishi",
      "Aldhafeeri", "Alenezi", "Alruwaili", "Alsaadi", "Alshahrani", "Alsibai", "Altamimi", "Alwadi",
      "Alyahya", "Alzaid", "Bakhsh", "Batterjee", "Fakieh", "Ghamdi", "Hakami", "Jamjoom",
      "Kaki", "Khashoggi", "Madani", "Nazer", "Qurban", "Radwan", "Sabbagh", "Tayeb",
      "Zamil", "Basrawi", "Dabbagh", "Fageeh", "Hariri", "Jokhdar", "Kurdi", "Linjawi",
      "Mishaal", "Nashar", "Qadi", "Rajhi", "Sindi", "Turkistani", "Zahid", "Bugshan",
    ],
  },
  Qatar: {
    weight: 2,
    first: [
      "Hassan", "Ali", "Ahmad", "Jassim", "Nasser", "Khalid", "Saad", "Hamad",
      "Tamim", "Rashid", "Mubarak", "Fahad", "Yousef", "Mansour", "Salem", "Ismail",
      "Zayed", "Ghanim", "Talal", "Bilal", "Karim", "Adel", "Waleed", "Sultan",
      "Abdulaziz", "Saleh", "Faisal", "Nawaf", "Majed", "Turki", "Rakan", "Ziyad",
      "Anas", "Marwan", "Badr", "Ibrahim", "Omar", "Salman", "Rayan", "Hatim",
      "Ayman", "Sami", "Jaber", "Rashed", "Thamer", "Yazeed", "Zaid", "Amjad",
      "Bassam", "Emad", "Fares", "Ghazi", "Haitham", "Jamal", "Kamal", "Laith",
      "Nabil", "Osama", "Qusai", "Rami", "Tarek", "Wael", "Yaser", "Zuhair",
      "Adnan", "Dawoud", "Eyad", "Firas", "Hazem", "Issam", "Khalaf", "Luay",
      "Mazen", "Naif", "Raed", "Suhail", "Basem", "Hisham", "Fawaz", "Mishal",
    ],
    last: [
      "Almarri", "Alsulaiti", "Alnaimi", "Albinali", "Alyazidi", "Alhajri", "Alemadi", "Almeer",
      "Alrumaihi", "Alshahwani", "Almansoori", "Alobaidly", "Alkubaisi", "Aljabri", "Alsada", "Alnuaimi",
      "Almohammed", "Alsalem", "Alkhater", "Almadadi", "Alkaabi", "Alboainin", "Aldarwish", "Alfardan",
      "Alattiyah", "Alansari", "Aldoseri", "Alghanim", "Alhitmi", "Aljassim", "Alkhalifa", "Almannai",
      "Alnasr", "Alqahtani", "Alrayes", "Alsaad", "Altamimi", "Alwahaibi", "Alyafei", "Alzaman",
      "Baabood", "Darwish", "Fakhroo", "Ghanem", "Hilal", "Ibrahim", "Jassim", "Kamal",
      "Latif", "Mahmoud", "Nasser", "Othman", "Qassim", "Rashid", "Saleh", "Tawfiq",
      "Wahab", "Yousef", "Zayed", "Abdulla", "Bader", "Dahlan", "Eissa", "Faraj",
      "Ghali", "Hammad", "Idris", "Jarrah", "Kadhim", "Lutfi", "Mubarak", "Nuaimi",
      "Obaid", "Qadir", "Rafiq", "Sabah", "Talib", "Umar", "Wasfi", "Yaqub",
    ],
  },
  "United Arab Emirates": {
    weight: 2,
    first: [
      "Khalifa", "Zayed", "Saeed", "Ahmed", "Mohammed", "Rashid", "Obaid", "Sultan",
      "Hamdan", "Majid", "Saif", "Ali", "Abdulrahman", "Hazza", "Tariq", "Yaqoub",
      "Ismail", "Salem", "Nasser", "Fares", "Adel", "Marwan", "Omar", "Jassem",
      "Abdulaziz", "Saleh", "Faisal", "Nawaf", "Turki", "Rakan", "Ziyad", "Anas",
      "Badr", "Salman", "Rayan", "Hatim", "Ayman", "Sami", "Jaber", "Rashed",
      "Thamer", "Yazeed", "Zaid", "Amjad", "Bassam", "Emad", "Ghazi", "Haitham",
      "Jamal", "Kamal", "Laith", "Nabil", "Osama", "Qusai", "Rami", "Tarek",
      "Wael", "Yaser", "Zuhair", "Adnan", "Dawoud", "Eyad", "Firas", "Hazem",
      "Issam", "Khalaf", "Luay", "Mazen", "Naif", "Raed", "Suhail", "Basem",
      "Hisham", "Fawaz", "Mishal", "Humaid", "Juma", "Mattar", "Salmeen", "Butti",
    ],
    last: [
      "Almarzooqi", "Alhammadi", "Alshamsi", "Almenhali", "Alblooshi", "Alnaqbi", "Alzaabi", "Alketbi",
      "Alraisi", "Almazrouei", "Alsuwaidi", "Alqubaisi", "Alhosani", "Aldhaheri", "Alameri", "Alyammahi",
      "Alnuaimi", "Alsaadi", "Alfalasi", "Alrahoumi", "Almulla", "Alderei", "Albreiki", "Alhefeiti",
      "Alqassimi", "Alnahyan", "Almaktoum", "Alsharqi", "Almualla", "Alhumaid", "Alkindi", "Almheiri",
      "Alrumaithi", "Alshehhi", "Altunaiji", "Alyafei", "Alzarooni", "Bumelha", "Darwish", "Fikri",
      "Ghubash", "Hilal", "Ibrahim", "Jarwan", "Kamali", "Lootah", "Madani", "Nabooda",
      "Obaidli", "Qassim", "Rostamani", "Sajwani", "Tayer", "Ubaid", "Wahedi", "Yousuf",
      "Zaabi", "Abdulla", "Bader", "Dahi", "Eissa", "Faraj", "Ghali", "Hammad",
      "Idris", "Jassim", "Kadhim", "Lutfi", "Mubarak", "Nuaimi", "Omran", "Qadir",
      "Rafiq", "Sabah", "Talib", "Umar", "Wasfi", "Yaqub", "Zayani", "Bilal",
    ],
  },
  Iraq: {
    weight: 2,
    first: [
      "Ali", "Hussein", "Mustafa", "Ahmed", "Karrar", "Bashar", "Hayder", "Mahmoud",
      "Saif", "Kadhim", "Rebin", "Amjad", "Alaa", "Ammar", "Ibrahim", "Zaid",
      "Sajjad", "Wissam", "Younis", "Firas", "Rashid", "Osama", "Muntadher", "Salam",
      "Abdulaziz", "Saleh", "Faisal", "Nawaf", "Turki", "Ziyad", "Anas", "Marwan",
      "Badr", "Salman", "Rayan", "Hatim", "Ayman", "Sami", "Jaber", "Rashed",
      "Thamer", "Yazeed", "Bassam", "Emad", "Fares", "Ghazi", "Haitham", "Jamal",
      "Kamal", "Laith", "Nabil", "Qusai", "Rami", "Tarek", "Wael", "Yaser",
      "Zuhair", "Adnan", "Dawoud", "Eyad", "Hazem", "Issam", "Khalaf", "Luay",
      "Mazen", "Naif", "Raed", "Suhail", "Basem", "Hisham", "Fawaz", "Mishal",
      "Ihsan", "Nabeel", "Sabah", "Talib", "Waleed",
    ],
    last: [
      "Alhasan", "Almousawi", "Alkhafaji", "Aljanabi", "Altamimi", "Alobaidi", "Alsaadi", "Alrubaie",
      "Alzubaidi", "Aldulaimi", "Alkaabi", "Alshammari", "Almaliki", "Alhamdani", "Alazzawi", "Alnasiri",
      "Barzani", "Rasheed", "Jassim", "Sabri", "Hameed", "Fadhil", "Yaseen", "Shakir",
      "Alani", "Albayati", "Aldelemi", "Alfaraji", "Algharbawi", "Alhilli", "Alissawi", "Aljabouri",
      "Alkarbalai", "Allami", "Almashhadani", "Alnajjar", "Alqaisi", "Alrawi", "Alsamarrai", "Altaie",
      "Alugaili", "Alwaeli", "Alyasiri", "Alzaidi", "Bakr", "Dawood", "Faraj", "Ghani",
      "Hadi", "Ismail", "Jawad", "Kareem", "Latif", "Mahdi", "Naji", "Obaid",
      "Qasim", "Radhi", "Salman", "Tahir", "Ubaid", "Wahab", "Yousif", "Zaki",
      "Abbas", "Bahjat", "Dhiab", "Faleh", "Ghazi", "Hilal", "Ibrahim", "Jalil",
      "Kamil", "Lateef", "Munir", "Nouri", "Othman", "Qahtan", "Rahim", "Saeed",
    ],
  },
  Uzbekistan: {
    weight: 2,
    first: [
      "Jasur", "Otabek", "Sardor", "Bekzod", "Azizbek", "Timur", "Rustam", "Doston",
      "Javohir", "Shohruh", "Bobur", "Alisher", "Farrukh", "Islom", "Sanjar", "Ulugbek",
      "Dilshod", "Aziz", "Nodir", "Eldor", "Kamron", "Anvar", "Muhammadali", "Sherzod",
      "Abror", "Behruz", "Davron", "Elyor", "Farhod", "Gulom", "Husan", "Ikrom",
      "Jahongir", "Komil", "Lochin", "Mansur", "Nurbek", "Odil", "Qahramon", "Ravshan",
      "Shavkat", "Tohir", "Umid", "Vohid", "Yusuf", "Zafar", "Akmal", "Bahodir",
      "Dilmurod", "Erkin", "Fazliddin", "Gayrat", "Hasan", "Ilhom", "Jasurbek", "Kamol",
      "Laziz", "Mirzo", "Nodirbek", "Oybek", "Qodir", "Rustambek", "Sarvar", "Temur",
      "Vali", "Yodgor", "Zohid", "Abduvali", "Baxtiyor", "Dilshodbek", "Ergash", "Firdavs",
      "Gulmurod", "Husniddin", "Ismoil", "Jamshid", "Kobil", "Muzaffar", "Nemat",
    ],
    last: [
      "Karimov", "Yusupov", "Rakhimov", "Ergashev", "Nazarov", "Tursunov", "Ibragimov", "Sharipov",
      "Juraev", "Umarov", "Saidov", "Alimov", "Kholmatov", "Rashidov", "Sultanov", "Mirzaev",
      "Abdullaev", "Toshmatov", "Qodirov", "Bekmurodov", "Nurmatov", "Hakimov", "Sobirov", "Ochilov",
      "Turaev", "Rasulov", "Yuldashev", "Kamalov", "Salimov", "Ismailov", "Ergashov", "Odilov",
      "Qosimov", "Rahmonov", "Shokirov", "Tashkentov", "Usmonov", "Valiev", "Yakubov", "Zokirov",
      "Abdurahmonov", "Bozorov", "Davlatov", "Egamberdiev", "Fayzullaev", "Gafurov", "Hamidov", "Islomov",
      "Jalilov", "Kurbanov", "Latipov", "Muminov", "Nabiev", "Pulatov", "Qayumov", "Radjabov",
      "Safarov", "Tolipov", "Ubaydullaev", "Vohidov", "Zaripov", "Boymurodov", "Dostonov", "Eshonqulov",
      "Fozilov", "Gulomov", "Hoshimov", "Ibrohimov", "Juraboev", "Karimberdiev", "Mahmudov", "Normatov",
      "Otajonov", "Qurbonov", "Rustamov",
    ],
  },
  Jordan: {
    weight: 2,
    first: [
      "Yazan", "Mahmoud", "Anas", "Ehsan", "Musa", "Bahaa", "Nizar", "Odai",
      "Hamza", "Feras", "Saeed", "Ahmad", "Tareq", "Laith", "Zaid", "Amer",
      "Sami", "Khalil", "Rami", "Bilal", "Mutaz", "Ismail", "Karam", "Ayman",
      "Abdulaziz", "Saleh", "Faisal", "Nawaf", "Turki", "Ziyad", "Marwan", "Badr",
      "Salman", "Rayan", "Hatim", "Jaber", "Rashed", "Thamer", "Yazeed", "Bassam",
      "Emad", "Fares", "Ghazi", "Haitham", "Jamal", "Kamal", "Nabil", "Osama",
      "Qusai", "Tarek", "Wael", "Yaser", "Zuhair", "Adnan", "Dawoud", "Eyad",
      "Firas", "Hazem", "Issam", "Khalaf", "Luay", "Mazen", "Naif", "Raed",
      "Suhail", "Basem", "Hisham", "Fawaz", "Mishal", "Amjad", "Ghassan", "Hani",
      "Imad", "Jihad", "Munir", "Nader", "Sufyan", "Wajdi",
    ],
    last: [
      "Alrawabdeh", "Almardi", "Alsaify", "Alfaqeeh", "Haddad", "Zreiqat", "Khattab", "Obeidat",
      "Shalabi", "Masalha", "Qatanani", "Tarawneh", "Sharaiha", "Hattab", "Barghouti", "Salameh",
      "Ghanem", "Nsour", "Rifai", "Dabbas", "Zawahreh", "Mansour", "Adwan", "Btoush",
      "Abdelhadi", "Alazzeh", "Albitar", "Aldabbas", "Alfaouri", "Alghoul", "Alhaj", "Aljazi",
      "Alkhatib", "Almasri", "Alnabulsi", "Alqudah", "Alrousan", "Alsawalha", "Altell", "Alzoubi",
      "Bakri", "Daoud", "Farah", "Gharaibeh", "Hamdan", "Issa", "Jaber", "Khoury",
      "Louzi", "Majali", "Nazzal", "Odeh", "Qasem", "Rabadi", "Sarayrah", "Tuqan",
      "Urabi", "Wahdan", "Yaghi", "Zaben", "Abuhamdeh", "Bisharat", "Dweik", "Fanek",
      "Ghosheh", "Hijazi", "Irsheid", "Jaradat", "Kilani", "Lubbadeh", "Muasher", "Nuseibeh",
      "Qattan", "Rimawi", "Shubeilat", "Tahboub", "Zurikat", "Bataineh", "Halaseh", "Sakhen",
    ],
  },
  Thailand: {
    weight: 2,
    first: [
      "Somchai", "Anuwat", "Pornthep", "Wichai", "Kittipong", "Nattawut", "Peerapat", "Worachit",
      "Jakkaphan", "Chaowat", "Thanawat", "Sarawut", "Nopporn", "Pichai", "Weerapong", "Krit",
      "Surachai", "Panupong", "Thanakrit", "Watcharin", "Sittichai", "Narong", "Prasert", "Chalermchai",
      "Apichai", "Boonmee", "Chaiwat", "Decha", "Ekachai", "Kamon", "Manop", "Naruemon",
      "Ophas", "Phuwadon", "Rattana", "Somsak", "Thawee", "Udom", "Wirat", "Yuthana",
      "Anuchit", "Boonchu", "Chatchai", "Damrong", "Ekkarat", "Kittisak", "Montri", "Niran",
      "Ongart", "Phichit", "Rungroj", "Sompong", "Thanet", "Uthai", "Wanchai", "Yongyut",
      "Adisorn", "Banjong", "Chalor", "Danai", "Ekapol", "Kraisorn", "Manas", "Nopadon",
      "Pairote", "Prayuth", "Sarayut", "Suthep", "Teerapong", "Vichian", "Wisut", "Yothin",
      "Amnat", "Bunsong", "Chaiyan", "Direk", "Kanit", "Manit", "Nikom", "Pongsak",
    ],
    last: [
      "Sangkaew", "Chaiyaphum", "Boonmathan", "Wongchai", "Srisuk", "Phromphao", "Kaewkla", "Thongchai",
      "Ratchanon", "Suksawat", "Prathum", "Charoensuk", "Meesap", "Ngamsom", "Panyapha", "Rungrueang",
      "Sitthichok", "Chindawong", "Bunlue", "Kanchana", "Somboon", "Wattana", "Yaemyuean", "Pholsawat",
      "Sirisuk", "Wattanakul", "Phanthong", "Chaiyasit", "Intharat", "Klahan", "Lertsiri", "Maneewan",
      "Nonthasin", "Pinyo", "Rattanapon", "Saengchan", "Thammasat", "Ubonrat", "Wongsiri", "Yothaka",
      "Aroonsri", "Buppha", "Chumpol", "Dokmai", "Ekkasit", "Kanjana", "Limthongkul", "Muangthong",
      "Nakhon", "Pattama", "Rojana", "Sawatdee", "Thepsuwan", "Uthaiwan", "Wichitra", "Yindee",
      "Amphon", "Bandit", "Chaisiri", "Duangjai", "Emsawat", "Kessara", "Laksana", "Malai",
      "Nithi", "Prasong", "Ratchada", "Sunthorn", "Thonglor", "Wisetsiri", "Yaowarat", "Apinya",
      "Boonyarat", "Chanthana", "Denduang", "Kamolwan", "Lamphun", "Mekhala", "Nopphon", "Phatthana",
    ],
  },
  Vietnam: {
    weight: 2,
    first: [
      "Quang", "Cong", "Duy", "Tien", "Hoang", "Minh", "Tuan", "Van",
      "Thanh", "Hung", "Trong", "Duc", "Anh", "Bao", "Khanh", "Nam",
      "Phuc", "Long", "Kien", "Truong", "Dat", "Hieu", "Vinh", "Son",
      "Chien", "Dung", "Giang", "Hai", "Khoa", "Loc", "Manh", "Nghia",
      "Phong", "Quan", "Sang", "Thai", "Trung", "Viet", "Xuan", "Bang",
      "Cuong", "Dai", "Hoa", "Huy", "Khai", "Linh", "Ngoc", "Phat",
      "Quy", "Tai", "Thang", "Tuong", "Vu", "Bien", "Chuong", "Dang",
      "Hoan", "Kiet", "Luan", "Nhan", "Phu", "Quoc", "Tam", "Thinh",
      "Tin", "Vien", "Binh", "Chi", "Doan", "Khang", "Lam", "Nhat",
      "Phuong", "Tan", "Thien", "Toan", "Xuyen",
    ],
    last: [
      "Nguyen", "Tran", "Le", "Pham", "Hoang", "Phan", "Vu", "Dang",
      "Bui", "Do", "Ho", "Ngo", "Duong", "Ly", "Dinh", "Truong",
      "Cao", "Mai", "Ta", "Trinh", "Luong", "Doan", "Quach", "Chu",
      "Ha", "Vuong", "Tang", "Thai", "Kieu", "Lam", "Luu", "Nghiem",
      "Ong", "Quan", "Thach", "Tong", "Uong", "Vo", "Xa", "Bach",
      "Chau", "Diep", "Giang", "Hua", "Khuc", "La", "Nghi", "Phung",
      "Quang", "Son", "Thieu", "Trieu", "Van", "Xuan", "Au", "Chung",
      "Dam", "Khong", "Lai", "Luc", "Nguy", "Phi", "Sy", "Thuy",
      "Trang", "Vi", "Vy", "Yen", "Bang",
    ],
  },
  Indonesia: {
    weight: 2,
    first: [
      "Bagus", "Rizky", "Andik", "Yanto", "Bambang", "Irfan", "Dedi", "Rachmat",
      "Ilham", "Dimas", "Kadek", "Wahyu", "Gian", "Yakob", "Ricky", "Agung",
      "Budi", "Hendra", "Joko", "Rudi", "Slamet", "Teguh", "Wawan", "Yudi",
      "Adi", "Bayu", "Candra", "Dwi", "Eko", "Fajar", "Galih", "Hari",
      "Indra", "Jaya", "Krisna", "Lukman", "Mulyadi", "Nanda", "Okto", "Putra",
      "Rizal", "Surya", "Tri", "Umar", "Wisnu", "Yoga", "Zainal", "Andi",
      "Bagas", "Cahyo", "Erik", "Ferry", "Guntur", "Hendri", "Jefri", "Kemal",
      "Latif", "Marwan", "Novan", "Oki", "Pandu", "Reza", "Sandi", "Taufik",
      "Ucok", "Vino", "Wahid", "Yanuar", "Zaki", "Arif", "Bima", "Danang",
      "Endra", "Faisal", "Gilang", "Hafiz", "Junaidi",
    ],
    last: [
      "Setiawan", "Wibowo", "Kurniawan", "Nugroho", "Santoso", "Hidayat", "Saputra", "Prasetyo",
      "Wijaya", "Susanto", "Utomo", "Hartono", "Firmansyah", "Ramadhan", "Maulana", "Permana",
      "Anggara", "Sihombing", "Simanjuntak", "Purnama", "Aditya", "Gunawan", "Harahap", "Sinaga",
      "Siregar", "Nasution", "Lubis", "Pohan", "Ritonga", "Batubara", "Panggabean", "Hasibuan",
      "Rangkuti", "Daulay", "Situmorang", "Pardede", "Manullang", "Sitorus", "Nainggolan", "Silalahi",
      "Tampubolon", "Hutapea", "Simatupang", "Marpaung", "Pasaribu", "Napitupulu", "Sinurat", "Hutabarat",
      "Sagala", "Tobing", "Ginting", "Sembiring", "Tarigan", "Bangun", "Perangin", "Surbakti",
      "Barus", "Kembaren", "Pinem", "Sitepu", "Karo", "Munthe", "Depari", "Bukit",
      "Colia", "Gultom", "Haloho", "Jawak", "Keliat", "Limbong", "Manik", "Nadeak",
      "Ompusunggu", "Pakpahan", "Rajagukguk", "Samosir", "Turnip", "Uli", "Waruwu", "Zebua",
    ],
  },
  Malaysia: {
    weight: 2,
    first: [
      "Syafiq", "Faisal", "Aidil", "Hafiz", "Azam", "Nazmi", "Farid", "Shahrul",
      "Amri", "Khairul", "Rizal", "Adam", "Harith", "Zafuan", "Nasir", "Akhyar",
      "Danial", "Haziq", "Izzat", "Luqman", "Naim", "Redzuan", "Shukri", "Zulhilmi",
      "Amirul", "Badrul", "Firdaus", "Hafizuddin", "Iskandar", "Jamil", "Khairi", "Lokman",
      "Muhaimin", "Nizam", "Osman", "Qayyum", "Ridzuan", "Saiful", "Taufiq", "Umar",
      "Wafi", "Yusri", "Zaidi", "Aminuddin", "Bakri", "Fauzi", "Hakimi", "Imran",
      "Junaidi", "Kamarul", "Mahathir", "Nabil", "Othman", "Qasim", "Rusli", "Sofian",
      "Tajuddin", "Uzair", "Wahid", "Yazid", "Zamri", "Anwar", "Basri", "Fadhil",
      "Hanif", "Ismadi", "Jasmi", "Khalid", "Muslim", "Norhisham", "Rafiq", "Shahrizal",
      "Termizi", "Umairi", "Wan", "Yunus", "Zulfadli", "Azman", "Daniel", "Faizal",
    ],
    last: [
      "Rasid", "Ahmad", "Halim", "Ismail", "Yusof", "Rahman", "Hashim", "Aziz",
      "Salleh", "Osman", "Jantan", "Nasir", "Mokhtar", "Ramli", "Zainal", "Kadir",
      "Mansor", "Sulaiman", "Idris", "Bakar", "Talib", "Wahab", "Zulkifli", "Latif",
      "Abdullah", "Hussein", "Yaacob", "Shafiq", "Mahmud", "Razak", "Hamzah", "Baharudin",
      "Chan", "Lim", "Tan", "Wong", "Lee", "Ng", "Ooi", "Teoh",
      "Yap", "Cheah", "Goh", "Khoo", "Loh", "Neoh", "Phang", "Sim",
      "Toh", "Yeoh", "Arumugam", "Balakrishnan", "Chandran", "Devan", "Ganesan", "Krishnan",
      "Maniam", "Nadarajah", "Palani", "Rajan", "Subramaniam", "Vellu", "Ariffin", "Bakri",
      "Daud", "Ghani", "Hamid", "Jaafar", "Kamal", "Mustapha", "Noordin", "Rahim",
      "Sahak", "Tahir", "Yahya", "Zakaria", "Anuar", "Bahar", "Fauzan", "Hakim",
    ],
  },
  Hungary: {
    weight: 2,
    first: [
      "Bence", "Adam", "Daniel", "Roland", "Zsolt", "Attila", "Gergo", "Balazs",
      "Marton", "Norbert", "Peter", "Laszlo", "Tamas", "Istvan", "Krisztian", "Andras",
      "Gabor", "Mate", "Levente", "Csaba", "Zoltan", "Akos", "Botond", "Kristof",
      "Milan", "Zalan", "Benedek", "Dominik", "Erik", "Ferenc", "Gergely", "Hunor",
      "Imre", "Janos", "Kalman", "Lajos", "Miklos", "Odon", "Pal", "Rudolf",
      "Sandor", "Tibor", "Vilmos", "Zsigmond", "Arpad", "Bela", "Csongor", "Dezso",
      "Elemer", "Farkas", "Gyula", "Huba", "Ivan", "Jozsef", "Karoly", "Lorinc",
      "Mihaly", "Nandor", "Otto", "Patrik", "Robert", "Soma", "Tivadar", "Vince",
      "Aron", "Bendeguz", "Domonkos", "Endre", "Henrik", "Konrad", "Marcell", "Oliver",
    ],
    last: [
      "Nagy", "Kovacs", "Toth", "Szabo", "Horvath", "Varga", "Kiss", "Molnar",
      "Nemeth", "Farkas", "Balogh", "Papp", "Takacs", "Juhasz", "Lakatos", "Meszaros",
      "Olah", "Simon", "Racz", "Fekete", "Torok", "Gulyas", "Fabian", "Veres",
      "Vincze", "Boros", "Illes", "Katona", "Nemes", "Orosz", "Pinter", "Sipos",
      "Somogyi", "Szucs", "Vass", "Barna", "Csonka", "Deak", "Gal", "Hegedus",
      "Jakab", "Kelemen", "Lengyel", "Magyar", "Novak", "Orban", "Pal", "Rada",
      "Sandor", "Tamas", "Urban", "Vamos", "Zsoldos", "Antal", "Bognar", "Csizmadia",
      "Dobos", "Elek", "Ferenczi", "Gergely", "Halasz", "Imre", "Jozsa", "Kertesz",
      "Lukacs", "Marton", "Nyari", "Orsos", "Palfi", "Regos", "Sarkozi", "Tibor",
      "Vig", "Zoltan", "Baranyi", "Csordas", "Dudas", "Erdelyi", "Fodor",
    ],
  },
  Bulgaria: {
    weight: 2,
    first: [
      "Georgi", "Ivan", "Dimitar", "Nikola", "Petar", "Stefan", "Todor", "Martin",
      "Kiril", "Aleksandar", "Vasil", "Boris", "Emil", "Radoslav", "Plamen", "Krasimir",
      "Yordan", "Zdravko", "Lyubomir", "Simeon", "Valeri", "Rumen", "Milen", "Ognyan",
      "Bozhidar", "Daniel", "Denis", "Filip", "Gabriel", "Hristian", "Iliyan", "Kaloyan",
      "Lachezar", "Miroslav", "Nikolay", "Pavel", "Slavi", "Teodor", "Ventsislav", "Yavor",
      "Zhivko", "Angel", "Blagoy", "Danail", "Evgeni", "Grigor", "Hristo", "Ivaylo",
      "Kamen", "Lyuben", "Marian", "Nedelcho", "Orlin", "Petko", "Rosen", "Stanislav",
      "Tihomir", "Vladimir", "Yanko", "Zahari", "Asen", "Borislav", "Dobromir", "Emiliyan",
      "Ilian", "Lyudmil", "Metodi", "Nayden", "Preslav", "Svetoslav", "Trayan", "Velizar",
      "Zlatan", "Boyan",
    ],
    last: [
      "Ivanov", "Petrov", "Dimitrov", "Georgiev", "Nikolov", "Todorov", "Stoyanov", "Angelov",
      "Iliev", "Kolev", "Marinov", "Vasilev", "Popov", "Hristov", "Atanasov", "Borisov",
      "Yanev", "Zlatev", "Delchev", "Kirilov", "Manolov", "Rusev", "Tsvetkov", "Slavov",
      "Aleksandrov", "Bozhilov", "Draganov", "Filipov", "Gerasimov", "Hadzhiev", "Lazarov", "Mihaylov",
      "Nedev", "Ognyanov", "Panayotov", "Radev", "Simeonov", "Tanev", "Uzunov", "Vladimirov",
      "Yankov", "Zhelev", "Andonov", "Bonev", "Dochev", "Filchev", "Gospodinov", "Hristozov",
      "Ivanchev", "Kalchev", "Lyubenov", "Minchev", "Naydenov", "Ovcharov", "Peev", "Radulov",
      "Stanchev", "Trifonov", "Uzunski", "Velikov", "Yordanov", "Zaharinov", "Apostolov", "Bakalov",
      "Dimov", "Ferdinandov", "Gochev", "Hubchev", "Iskrenov", "Karadzhov", "Lozanov", "Milanov",
      "Nikolchev", "Petkov", "Stoykov", "Tomov", "Videnov",
    ],
  },
  Russia: {
    weight: 2,
    first: [
      "Aleksandr", "Dmitri", "Sergei", "Andrei", "Ivan", "Maksim", "Nikolai", "Roman",
      "Artem", "Denis", "Kirill", "Egor", "Vladimir", "Pavel", "Anton", "Yuri",
      "Mikhail", "Aleksei", "Ilya", "Danila", "Gleb", "Timur", "Fedor", "Vadim",
      "Vyacheslav", "Stanislav", "Rostislav", "Vsevolod", "Arkadi", "Bogdan", "Valentin", "Georgi",
      "Grigori", "Innokenti", "Konstantin", "Leonid", "Matvei", "Nikita", "Oleg", "Prokhor",
      "Rodion", "Semyon", "Timofei", "Valeri", "Yakov", "Zakhar", "Arseni", "Boris",
      "Vitali", "Gennadi", "Yefim", "Zhenya", "Ignat", "Kuzma", "Lev", "Miron",
      "Nazar", "Osip", "Platon", "Radmir", "Savva", "Trofim", "Ustin", "Filipp",
      "Kharlam", "Tsezar", "Chesla", "Shamil", "Eduard", "Yulian", "Yaroslav", "Anatoli",
      "Vladislav", "German", "Danil", "Yevgeni", "Zinovi", "Ilarion", "Klim", "Lavr",
    ],
    last: [
      "Ivanov", "Smirnov", "Kuznetsov", "Popov", "Sokolov", "Lebedev", "Kozlov", "Novikov",
      "Morozov", "Petrov", "Volkov", "Solovyov", "Vasilyev", "Zaytsev", "Pavlov", "Semenov",
      "Golubev", "Vinogradov", "Bogdanov", "Vorobyov", "Fedorov", "Mikhailov", "Belyaev", "Tarasov",
      "Nikolaev", "Orlov", "Andreev", "Makarov", "Nikitin", "Zakharov", "Zuev", "Borisov",
      "Yakovlev", "Grigoryev", "Romanov", "Vorontsov", "Filatov", "Osipov", "Titov", "Markov",
      "Melnikov", "Shcherbakov", "Kolesnikov", "Ilyin", "Gusev", "Titarenko", "Frolov", "Zhukov",
      "Baranov", "Nikiforov", "Veselov", "Sorokin", "Ustinov", "Yefimov", "Kalinin", "Sergeev",
      "Panov", "Loginov", "Karpov", "Bykov", "Gorbunov", "Dorofeev", "Yermakov", "Zhdanov",
      "Isaev", "Kotov", "Lukin", "Maslov", "Naumov", "Ovchinnikov", "Poliakov", "Rybakov",
      "Savelyev", "Trofimov", "Ulyanov", "Fomin", "Tsvetkov", "Chernov", "Shubin", "Yudin",
    ],
  },
  Georgia: {
    weight: 2,
    first: [
      "Giorgi", "Levan", "Nika", "Irakli", "Zurab", "Davit", "Otar", "Guram",
      "Vakhtang", "Saba", "Luka", "Beka", "Tornike", "Aleksandre", "Shota", "Merab",
      "Lasha", "Gela", "Temur", "Ilia", "Zaza", "Rati", "Nodar", "Sandro",
      "Nikoloz", "Zviad", "Badri", "Datuna", "Elguja", "Grigol", "Ioseb", "Konstantine",
      "Malkhaz", "Nugzar", "Paata", "Revaz", "Soso", "Tengiz", "Ucha", "Valeri",
      "Amiran", "Bidzina", "Edisher", "Gocha", "Iraklis", "Kakha", "Levani", "Mamuka",
      "Omari", "Pridon", "Rezo", "Shalva", "Tariel", "Vano", "Zurabi", "Archil",
      "Dato", "Emzar", "Gia", "Koba", "Mindia", "Niko", "Temuri", "Vasil",
      "Zaal", "Aleko", "Besik",
    ],
    last: [
      "Beridze", "Lomidze", "Gogia", "Chkheidze", "Maisuradze", "Tsiklauri", "Kapanadze", "Javakhishvili",
      "Mikeladze", "Nozadze", "Gelashvili", "Kobakhidze", "Tabatadze", "Baramidze", "Dzneladze", "Kharaishvili",
      "Papava", "Sturua", "Tsereteli", "Gurgenidze", "Kutateladze", "Chikovani", "Meladze", "Tsulaia",
      "Abashidze", "Bakradze", "Chanturia", "Dolidze", "Eliava", "Gogoladze", "Iremadze", "Jorbenadze",
      "Kiknadze", "Lomtadze", "Managadze", "Nadiradze", "Odishvili", "Pkhakadze", "Rukhadze", "Samkharadze",
      "Tskhadadze", "Ugrekhelidze", "Vashakidze", "Zhordania", "Akhalaia", "Bezhanishvili", "Chelidze", "Devadze",
      "Erkomaishvili", "Giorgadze", "Imedashvili", "Janelidze", "Khubutia", "Lortkipanidze", "Mgeladze", "Nemsadze",
      "Osepashvili", "Peradze", "Ramishvili", "Sikharulidze", "Tvildiani", "Urushadze", "Vardosanidze", "Zurabashvili",
      "Amiranashvili", "Berishvili", "Chubinidze", "Dvalishvili", "Gagnidze", "Iashvili", "Kalandadze", "Lomsadze",
      "Mikadze", "Natsvlishvili", "Pipia", "Shengelaia",
    ],
  },
  "North Macedonia": {
    weight: 2,
    first: [
      "Goran", "Stefan", "Aleksandar", "Darko", "Ilija", "Bojan", "Nikola", "Marjan",
      "Vlatko", "Filip", "Kire", "Dejan", "Zoran", "Mite", "Trajko", "Blagoja",
      "Ognen", "Risto", "Slave", "Vanco", "Igor", "Petar", "Mario", "Boban",
      "Vasko", "Borce", "Cvetan", "Dragan", "Elvis", "Ferid", "Gjorgji", "Hristijan",
      "Igorche", "Jovan", "Kristijan", "Ljupco", "Metodija", "Naum", "Orce", "Pande",
      "Riste", "Sasho", "Toni", "Vasil", "Zlatko", "Andrej", "Blagoj", "Daniel",
      "Emil", "Goce", "Jane", "Lazar", "Martin", "Pero", "Robert", "Stole",
      "Tome", "Angel", "Bobi", "Erhan", "Gligor", "Hristo", "Jovica", "Kole",
      "Ljubomir", "Mile", "Nenad",
    ],
    last: [
      "Stojanovski", "Ristovski", "Trajkovski", "Nikolovski", "Petrovski", "Georgievski", "Dimitrievski", "Angelovski",
      "Ivanovski", "Mitrevski", "Jovanovski", "Velkovski", "Spasovski", "Todorovski", "Kostovski", "Bogdanovski",
      "Naumovski", "Zdravkovski", "Manevski", "Cvetkovski", "Lazarevski", "Simonovski", "Panev", "Gjorgjev",
      "Kostadinovski", "Andonovski", "Bogoevski", "Cvetanovski", "Damjanovski", "Efremovski", "Filipovski", "Gjorgjievski",
      "Hristovski", "Ilievski", "Janevski", "Krstevski", "Ljubenovski", "Markovski", "Nedelkovski", "Ognenovski",
      "Pavlovski", "Risteski", "Stefanovski", "Tasevski", "Vasilevski", "Zafirovski", "Blazevski", "Cvetkoski",
      "Dimovski", "Efimov", "Gjorgjiev", "Hristov", "Iliev", "Janev", "Kostov", "Lazarov",
      "Mitkovski", "Nikolov", "Ordev", "Petkovski", "Ristov", "Stojkovski", "Trajkov", "Vasilev",
      "Zdravkov", "Atanasovski", "Bozinovski", "Chalovski", "Despotovski", "Gjurovski", "Hadzievski", "Josifovski",
      "Kotevski", "Micevski", "Naumov", "Panovski", "Todorov", "Velkov",
    ],
  },
  Montenegro: {
    weight: 2,
    first: [
      "Stefan", "Marko", "Nikola", "Milos", "Vladimir", "Luka", "Filip", "Aleksandar",
      "Dejan", "Igor", "Bojan", "Danilo", "Petar", "Risto", "Zarko", "Vukan",
      "Balsa", "Nemanja", "Andrija", "Milan", "Uros", "Savo", "Drasko", "Mirko",
      "Bozidar", "Dragan", "Goran", "Ivan", "Jovan", "Krsto", "Lazar", "Mihailo",
      "Novica", "Ognjen", "Pavle", "Radomir", "Slavko", "Tomo", "Veselin", "Blagota",
      "Cedomir", "Dusan", "Gojko", "Ilija", "Janko", "Krunoslav", "Ljubo", "Miodrag",
      "Obrad", "Predrag", "Rade", "Stevan", "Todor", "Veljko", "Zoran", "Borislav",
      "Damjan", "Djordje", "Gavro", "Jakov", "Kosta", "Ljubomir", "Milutin", "Nenad",
      "Radivoje", "Srdjan", "Tripo", "Vuk", "Zeljko", "Bogdan", "Cvetko",
    ],
    last: [
      "Vukcevic", "Jovanovic", "Popovic", "Radovic", "Perovic", "Boskovic", "Djukic", "Scepanovic",
      "Vujosevic", "Kaludjerovic", "Lekic", "Ivanovic", "Nikolic", "Milic", "Backovic", "Raicevic",
      "Djurovic", "Tomasevic", "Knezevic", "Bulatovic", "Markovic", "Adzic", "Kalezic", "Zecevic",
      "Vujovic", "Radulovic", "Djurisic", "Krivokapic", "Mijuskovic", "Nikcevic", "Pejovic", "Rakocevic",
      "Saranovic", "Terzic", "Vlahovic", "Zivkovic", "Asanovic", "Brnovic", "Curovic", "Djuranovic",
      "Golubovic", "Ivanisevic", "Jovetic", "Klikovac", "Ljumovic", "Milacic", "Novovic", "Obradovic",
      "Pekovic", "Radunovic", "Scekic", "Tomcic", "Vucinic", "Zejak", "Babovic", "Cetkovic",
      "Dragojevic", "Femic", "Gvozdenovic", "Ivezic", "Jankovic", "Kaljevic", "Lopicic", "Mugosa",
      "Nenezic", "Ostojic", "Pavicevic", "Rasovic", "Stanisic", "Tatar", "Vukotic", "Zoric",
      "Bulajic", "Cukic", "Djalovic", "Filipovic", "Grbovic", "Jaukovic", "Kovacevic",
    ],
  },
  "Northern Ireland": {
    weight: 2,
    first: [
      "Steven", "Jonny", "Craig", "Niall", "Conor", "Paddy", "Shane", "Gareth",
      "Stuart", "Ciaron", "Daniel", "Ryan", "Michael", "Liam", "Trai", "Bailey",
      "Isaac", "Jordan", "Aaron", "Kyle", "Ross", "Dale", "Rory", "Barry",
      "Cathal", "Eoin", "Ruairi", "Padraig", "Seamus", "Oisin", "Fionn", "Declan",
      "Colm", "Fergal", "Gerard", "Hugh", "Ivan", "Joseph", "Kieran", "Lorcan",
      "Malachy", "Nial", "Oran", "Peter", "Robert", "Sean", "Thomas", "Ultan",
      "Vincent", "William", "Adrian", "Ciaran", "David", "Eamonn", "Francis", "Gary",
      "Harry", "James", "Karl", "Leo", "Mark", "Neil", "Owen", "Philip",
      "Simon", "Terence", "Vaughan", "Wesley", "Andrew", "Brendan", "Cormac", "Damien",
      "Edward", "Finbar", "Graham", "Hugo", "Ian", "John",
    ],
    last: [
      "Ferguson", "Hughes", "Bradley", "Donnelly", "McCann", "Reilly", "Devine", "Kearns",
      "Charles", "Toal", "Peacock", "Hume", "Brown", "McKenna", "Doherty", "Campbell",
      "Gallagher", "Hamilton", "Kennedy", "Maguire", "Nolan", "Quinn", "Sloan", "Thompson",
      "Wilson", "Johnston", "Moore", "Stewart", "Bell", "Graham", "Patterson", "Robinson",
      "Scott", "Wallace", "Anderson", "Bryson", "Craig", "Dickson", "Elliott", "Fitzpatrick",
      "Gilmore", "Harte", "Irwin", "Jamison", "Kane", "Lynch", "Mallon", "Nesbitt",
      "Orr", "Patton", "Quigley", "Rea", "Sloane", "Todd", "Vance", "Watters",
      "Adair", "Blair", "Cassidy", "Dunlop", "Erskine", "Fulton", "Gribben", "Hutchinson",
      "Irvine", "Johnson", "Kerr", "Lyttle", "McAllister", "Nicholl", "Officer", "Porter",
      "Rankin", "Semple", "Trimble", "Uprichard", "Wylie", "Barr", "Colhoun", "Dorrian",
    ],
  },
  Belarus: {
    weight: 2,
    first: [
      "Maksim", "Ihar", "Siarhei", "Dzmitry", "Yauheni", "Aliaksandr", "Vitaly", "Anton",
      "Pavel", "Uladzimir", "Mikita", "Kiryl", "Raman", "Artsiom", "Yury", "Andrei",
      "Stanislau", "Valery", "Denis", "Ivan", "Hleb", "Nikolai", "Ruslan", "Vadzim",
      "Vitaliy", "Uladzislau", "Yaraslau", "Hennadz", "Leanid", "Matsvei", "Alieh", "Radzim",
      "Symon", "Tsimafei", "Yakau", "Zakhar", "Arsen", "Barys", "Henadz", "Yauhen",
      "Ihnat", "Kuzma", "Leu", "Miron", "Nazar", "Platon", "Sava", "Trafim",
      "Filip", "Eduard", "Yulyan", "Anatol", "Herman", "Danila", "Zinovi", "Klim",
      "Lavon", "Marat", "Naum", "Panas", "Rygor", "Stsiapan", "Uladzik", "Vasil",
      "Yakim", "Zmitser", "Ales", "Bahdan", "Damir", "Eryk", "Fiodar", "Jazep",
      "Karol", "Lukash", "Maksym",
    ],
    last: [
      "Ivanou", "Kavalenka", "Novik", "Sauchanka", "Yarmolenka", "Bandarenka", "Karpovich", "Shestakou",
      "Zhuk", "Kazlou", "Marozau", "Dubrouka", "Hancharou", "Sidarenka", "Vasilieu", "Klimovich",
      "Rybak", "Astapenka", "Miatliuk", "Pashkevich", "Sakalou", "Zaitsau", "Belski", "Hrytsuk",
      "Alieksieyeu", "Barysau", "Charnyshou", "Drazdou", "Fiodarau", "Halubovich", "Hrytsau", "Ihnatau",
      "Kavalchuk", "Kruk", "Lapatka", "Lisouski", "Makarau", "Mikhailau", "Nikitsin", "Palchevski",
      "Piatrou", "Radzivil", "Sialiun", "Siamashka", "Stsiapanau", "Tarasau", "Trafimau", "Uladzimirau",
      "Vaitovich", "Yakauleu", "Zakharau", "Zhukouski", "Barouski", "Cherkas", "Dashkevich", "Fiodaruk",
      "Halavach", "Hurski", "Iljushchanka", "Kazakevich", "Kuzniatsou", "Labanau", "Luchanok", "Maslau",
      "Miatlitski", "Naumchyk", "Paulau", "Piatkevich", "Rusakevich", "Savitski", "Shymanski", "Statkevich",
      "Tsimoshanka", "Vashkevich", "Yakimovich", "Zaharevich", "Zhuravel", "Buzuk", "Charniak", "Dulub",
    ],
  },
  Ethiopia: {
    weight: 2,
    first: [
      "Abebe", "Tesfaye", "Getachew", "Bekele", "Dawit", "Yohannes", "Solomon", "Mulugeta",
      "Girma", "Alemayehu", "Fikru", "Henok", "Samson", "Biruk", "Tewodros", "Kalab",
      "Addis", "Berhanu", "Eyasu", "Nahom", "Robel", "Sisay", "Yared", "Zewdu",
      "Getahun", "Kassahun", "Mesfin", "Tilahun", "Wondimu", "Bereket", "Endale", "Fasil",
      "Gebremariam", "Hailu", "Iyasu", "Kidane", "Legesse", "Mekuria", "Negussie", "Petros",
      "Rediet", "Seyoum", "Tamrat", "Wubshet", "Yonas", "Zelalem", "Abel", "Binyam",
      "Dagim", "Elias", "Fitsum", "Gashaw", "Hagos", "Israel", "Kaleab", "Lidetu",
      "Mikias", "Natnael", "Oliyad", "Petrus", "Rahel", "Surafel", "Tsegaye", "Wendwesen",
      "Yosef", "Zerihun", "Anteneh", "Behailu", "Chala", "Dereje", "Ephrem", "Feleke",
      "Gemechu", "Hunde", "Iyob", "Kebede", "Melaku", "Nebiyu", "Oumer", "Tadele",
    ],
    last: [
      "Tadesse", "Haile", "Kebede", "Assefa", "Wolde", "Mekonnen", "Desta", "Gebre",
      "Tekle", "Alemu", "Belay", "Negash", "Abera", "Demissie", "Gizaw", "Lemma",
      "Mengistu", "Shiferaw", "Teshome", "Worku", "Yimer", "Zerihun", "Habte", "Ayele",
      "Gebremedhin", "Woldemariam", "Tesfamariam", "Hailemariam", "Gebrehiwot", "Berhane", "Fikadu", "Gelaw",
      "Hagos", "Kassa", "Legese", "Molla", "Nega", "Oljira", "Regassa", "Seyoum",
      "Tsegay", "Wubet", "Yohannes", "Zeleke", "Abate", "Bekele", "Chane", "Dagne",
      "Endale", "Feyisa", "Girma", "Hunde", "Jemal", "Kumsa", "Melese", "Nigatu",
      "Olana", "Sori", "Tolera", "Urgessa", "Wakjira", "Yadeta", "Zewde", "Amare",
      "Beyene", "Chekol", "Debele", "Eshetu", "Fantahun", "Getnet", "Hailu", "Kifle",
      "Mamo", "Nuru", "Oumer", "Retta", "Sisay", "Tafesse",
    ],
  },
  Uganda: {
    weight: 2,
    first: [
      "Emmanuel", "Farouk", "Allan", "Khalid", "Milton", "Ibrahim", "Moses", "Joseph",
      "Ronald", "Isaac", "Tadeo", "Halid", "Steven", "Fahad", "Patrick", "Derrick",
      "Timothy", "Kenneth", "Aziz", "Yunus", "Gavin", "Simon", "Robert", "Julius",
      "Peter", "Samuel", "David", "John", "Daniel", "Michael", "Charles", "Francis",
      "George", "Henry", "James", "Kelvin", "Lawrence", "Martin", "Nicholas", "Oliver",
      "Philip", "Richard", "Stephen", "Thomas", "Victor", "William", "Anthony", "Benson",
      "Collins", "Dennis", "Edwin", "Felix", "Gideon", "Harrison", "Ian", "Jackson",
      "Kennedy", "Lewis", "Nelson", "Owen", "Paul", "Reuben", "Vincent", "Wilson",
      "Alfred", "Brian", "Cyprian", "Douglas", "Elias", "Fredrick", "Gerald", "Hillary",
      "Innocent",
    ],
    last: [
      "Ssekiganda", "Lwanga", "Kaddu", "Mutyaba", "Nsibambi", "Walusimbi", "Ssenkumba", "Katongole",
      "Mugume", "Sserunkuma", "Wasswa", "Tumusiime", "Okello", "Kagimu", "Lubega", "Mukasa",
      "Nabende", "Ochieng", "Opio", "Ssembatya", "Tugume", "Wanyama", "Kizza", "Namara",
      "Ssebugwawo", "Tumwine", "Wakaisuka", "Buyinza", "Ddamulira", "Ekwaro", "Guma", "Isabirye",
      "Kagoda", "Lubwama", "Mugerwa", "Nsereko", "Okurut", "Rwabushaija", "Sentongo", "Tinkasiimire",
      "Wandera", "Zziwa", "Ainebyona", "Bwire", "Dhikusooka", "Elau", "Gyagenda", "Isanga",
      "Kaggwa", "Lukwago", "Musisi", "Nabimanya", "Ojok", "Rukundo", "Ssentamu", "Twinamatsiko",
      "Zavuga", "Asiimwe", "Byaruhanga", "Draku", "Emojong", "Gumisiriza", "Iga", "Kayemba",
      "Lumu", "Mwesigwa", "Nabbanja", "Otim", "Rutabingwa", "Sserugo", "Waiswa", "Ziritwawula",
      "Businge", "Dhaira", "Ejang", "Kamoga",
    ],
  },
  Zimbabwe: {
    weight: 2,
    first: [
      "Knowledge", "Marvelous", "Tendai", "Marshall", "Talent", "Tinotenda", "Blessing", "Terrence",
      "Divine", "Prince", "Kudakwashe", "Munashe", "Farai", "Tafadzwa", "Simba", "Panashe",
      "Brighton", "Takudzwa", "Never", "Wellington", "Admiral", "Costa", "Tapiwa", "Nyasha",
      "Tinashe", "Tapiwanashe", "Munyaradzi", "Takunda", "Tanaka", "Anesu", "Batsirai", "Chenai",
      "Dzikamai", "Emmanuel", "Fungai", "Garikai", "Hardlife", "Innocent", "Joel", "Kundai",
      "Learnmore", "Method", "Onismor", "Progress", "Rodwell", "Shepherd", "Tatenda", "Vusumuzi",
      "Walter", "Xolani", "Yeukai", "Zvikomborero", "Abel", "Believe", "Clive", "Danny",
      "Edmore", "Freedom", "Gift", "Honest", "Ishmael", "Justice", "Kelvin", "Lovemore",
      "Misheck", "Nqobizitha", "Obey", "Peter", "Qadr", "Ronald", "Tichaona", "Upenyu",
      "Victor", "Wisdom", "Yotamu", "Zenzo", "Admire", "Blessed",
    ],
    last: [
      "Moyo", "Ndlovu", "Sibanda", "Dube", "Mpofu", "Chirwa", "Mavhunga", "Mudimu",
      "Marufu", "Gwekwerere", "Rusike", "Mangwiro", "Chikwature", "Gumbo", "Madzivanyika", "Nyoni",
      "Shumba", "Tsvangirai", "Zhou", "Mutasa", "Chigumba", "Makoni", "Nhema", "Zvobgo",
      "Chikwanda", "Bhebhe", "Chidzambwa", "Dembare", "Fungura", "Gochera", "Hondo", "Jaravaza",
      "Kamusoko", "Lunga", "Machakaire", "Nyambo", "Ophious", "Phiri", "Sibindi", "Tembo",
      "Ushe", "Vengesai", "Zulu", "Bhasera", "Chirinda", "Dzvukamanja", "Fombe", "Gadzikwa",
      "Hlomayi", "Jiri", "Karuru", "Lungu", "Mudzingwa", "Ncube", "Osaki", "Pasipanodya",
      "Rusawo", "Sadiki", "Tavengwa", "Utete", "Vera", "Zimondi", "Bimha", "Chipangura",
      "Dhliwayo", "Foloko", "Gwara", "Hadebe", "Jere",
    ],
  },
  Sudan: {
    weight: 2,
    first: [
      "Mohamed", "Ahmed", "Abdelrahman", "Musab", "Salah", "Waleed", "Bakri", "Yasir",
      "Tayseer", "Sharaf", "Mustafa", "Osman", "Hisham", "Kamal", "Idris", "Ammar",
      "Mazin", "Rayan", "Sabir", "Hatim", "Omar", "Zuhair", "Nasr", "Tarig",
      "Abdulaziz", "Saleh", "Faisal", "Nawaf", "Turki", "Ziyad", "Marwan", "Badr",
      "Salman", "Sami", "Jaber", "Rashed", "Thamer", "Yazeed", "Bassam", "Emad",
      "Fares", "Ghazi", "Haitham", "Jamal", "Nabil", "Qusai", "Tarek", "Wael",
      "Yaser", "Adnan", "Dawoud", "Eyad", "Firas", "Hazem", "Issam", "Khalaf",
      "Luay", "Mazen", "Naif", "Raed", "Suhail", "Basem", "Fawaz", "Mishal",
      "Amjad", "Ramzi", "Ghassan", "Hani", "Imad", "Jihad", "Munir", "Nader",
      "Sufyan", "Wajdi",
    ],
    last: [
      "Abdalla", "Elsheikh", "Hassan", "Ibrahim", "Osman", "Ahmed", "Mahmoud", "Bakhit",
      "Hamid", "Yousif", "Suleiman", "Adam", "Elamin", "Gasim", "Nour", "Tia",
      "Karrar", "Fadl", "Mukhtar", "Rahma", "Salih", "Tambal", "Wadi", "Zakaria",
      "Abdelgadir", "Alfadil", "Algack", "Alhaj", "Alimam", "Alkhalifa", "Almahdi", "Alnour",
      "Alrayah", "Alsammani", "Altayeb", "Alzubair", "Babiker", "Dafalla", "Elhassan", "Fadlalla",
      "Gadalla", "Hamza", "Ishag", "Jamal", "Kheir", "Lutfi", "Mekki", "Nimir",
      "Sirag", "Taha", "Wagdi", "Yagoub", "Zein", "Abusin", "Bashir", "Deng",
      "Eltayeb", "Farah", "Garang", "Hamdan", "Ismail", "Juma", "Kamal", "Lual",
      "Malik", "Nasr", "Omer", "Ramadan", "Sharif", "Tijani", "Widatalla", "Yassin",
      "Ziada", "Abdelhalim", "Bakheit", "Dirar", "Fathi",
    ],
  },
  Libya: {
    weight: 2,
    first: [
      "Muaid", "Ahmed", "Sand", "Mohamed", "Faisal", "Anis", "Ali", "Omar",
      "Salem", "Tareq", "Motasem", "Abdullah", "Sofiane", "Nader", "Rabie", "Marwan",
      "Ayoub", "Khaled", "Bilal", "Mansour", "Younes", "Hussein", "Adel", "Fathi",
      "Abdulaziz", "Saleh", "Nawaf", "Turki", "Ziyad", "Badr", "Salman", "Rayan",
      "Hatim", "Sami", "Jaber", "Rashed", "Thamer", "Yazeed", "Bassam", "Emad",
      "Fares", "Ghazi", "Haitham", "Jamal", "Kamal", "Nabil", "Osama", "Qusai",
      "Tarek", "Wael", "Yaser", "Zuhair", "Adnan", "Dawoud", "Eyad", "Firas",
      "Hazem", "Issam", "Khalaf", "Luay", "Mazen", "Naif", "Raed", "Suhail",
      "Basem", "Hisham", "Fawaz", "Mishal", "Amjad", "Ramzi", "Ghassan", "Hani",
      "Imad", "Jihad", "Munir", "Sufyan", "Wajdi",
    ],
    last: [
      "Alsaghir", "Bengargeb", "Zubya", "Alfitouri", "Almeriami", "Elshaykhi", "Abdelrahman", "Alghazal",
      "Elmabrouk", "Ashour", "Krewi", "Almuntasir", "Bendarwish", "Elhadi", "Ferjani", "Gwaider",
      "Hamad", "Kadiki", "Nashnoush", "Salem", "Tarhouni", "Zubi", "Misrati", "Werfalli",
      "Abusalem", "Alarabi", "Albarghathi", "Aldursi", "Alfaqih", "Algheriani", "Alhouni", "Alkabir",
      "Almadani", "Alnaas", "Alobeidi", "Alqadi", "Alrayes", "Alsanussi", "Altarhouni", "Alwerfalli",
      "Bengashir", "Darrat", "Faituri", "Gargoum", "Hamed", "Idris", "Jibril", "Kaabar",
      "Lamin", "Maatouk", "Nuri", "Omar", "Qaddour", "Rahim", "Sadeq", "Tantoush",
      "Ubaid", "Wadi", "Yunis", "Zarrouk", "Abuhajar", "Bashir", "Dabbashi", "Ghariani",
      "Hadi", "Ismail", "Jouda", "Khalil", "Mansur", "Nassr", "Othman", "Qasim",
      "Ramadan", "Shalabi", "Tuwati", "Warfali", "Yousef", "Zawi", "Bouzid",
    ],
  },
  Togo: {
    weight: 2,
    first: [
      "Kodjo", "Kossi", "Yao", "Komlan", "Serge", "Mathieu", "Floyd", "Peniel",
      "Roger", "Kevin", "Sadat", "Thibault", "Samuel", "Fo", "Gnama", "Dove",
      "Atakora", "Bassah", "Kwame", "Etse", "Afi", "Elom", "Mawuli", "Sena",
      "Ibrahim", "Mamadou", "Ousmane", "Abdoulaye", "Cheikh", "Modou", "Alassane", "Bakary",
      "Boubacar", "Lamine", "Moussa", "Seydou", "Amadou", "Souleymane", "Youssouf", "Karim",
      "Idrissa", "Sekou", "Aliou", "Bocar", "Demba", "Fode", "Habib", "Issa",
      "Kalidou", "Malick", "Ndiaga", "Omar", "Pape", "Saliou", "Tidiane", "Yaya",
      "Adama", "Bassirou", "Cherif", "Djibril", "Elhadji", "Fallou", "Gora", "Hamidou",
      "Insa", "Jules", "Khadim", "Landing", "Mor", "Nfally", "Oumar", "Pathe",
      "Salif", "Thierno", "Waly", "Yankuba", "Zale", "Baba", "Cheikhou", "Dame",
    ],
    last: [
      "Akakpo", "Amewou", "Segbefia", "Tchakei", "Lawson", "Aholou", "Bessan", "Djiwa",
      "Fambo", "Kossi", "Mensah", "Nyavor", "Ouro", "Tchagnirou", "Adjei", "Akoto",
      "Attiogbe", "Bawa", "Djato", "Folly", "Gnandi", "Kponton", "Sowu", "Tetteh",
      "Agbenowossi", "Amegan", "Botchway", "Dogbe", "Edoh", "Fiawoo", "Gbadago", "Hodo",
      "Ketohou", "Mensa", "Nukunu", "Ogunsola", "Pekoun", "Quashie", "Ramanou", "Sallah",
      "Tchalla", "Ubotse", "Vovor", "Wolou", "Yao", "Zinsou", "Abalo", "Bodjona",
      "Denou", "Efoe", "Gnaro", "Houngbo", "Ihou", "Jonas", "Klu", "Logossou",
      "Mawuko", "Nyamsi", "Oke", "Pessi", "Quenum", "Rachidou", "Segla", "Tchani",
      "Uwem", "Vigan", "Womdim", "Yovo", "Zoglo", "Ablavi", "Doe", "Etse",
      "Gbeti", "Hounkpe", "Issifou", "Kponvi", "Lomotey", "Mally",
    ],
  },
  Benin: {
    weight: 2,
    first: [
      "Steve", "Jodel", "Cebio", "Olivier", "Mickael", "Jordan", "David", "Marcellin",
      "Rodrigue", "Yohan", "Desire", "Khaled", "Junior", "Tidjani", "Seibou", "Imourane",
      "Moise", "Cedric", "Farid", "Andreas", "Emmanuel", "Rachad", "Bruno", "Landry",
      "Ibrahim", "Mamadou", "Ousmane", "Abdoulaye", "Cheikh", "Modou", "Alassane", "Bakary",
      "Boubacar", "Lamine", "Moussa", "Seydou", "Amadou", "Souleymane", "Youssouf", "Karim",
      "Idrissa", "Sekou", "Aliou", "Bocar", "Demba", "Fode", "Habib", "Issa",
      "Kalidou", "Malick", "Ndiaga", "Omar", "Pape", "Saliou", "Tidiane", "Yaya",
      "Adama", "Bassirou", "Cherif", "Djibril", "Elhadji", "Fallou", "Gora", "Hamidou",
      "Insa", "Jules", "Khadim", "Landing", "Mor", "Nfally", "Oumar", "Pathe",
      "Salif", "Thierno", "Waly", "Yankuba", "Zale", "Baba", "Cheikhou", "Dame",
    ],
    last: [
      "Dossou", "Kiki", "Ahouanou", "Assogba", "Hountondji", "Agbegniadan", "Bokpe", "Djidonou",
      "Gbaguidi", "Hodonou", "Koukpo", "Lokonon", "Migan", "Nouwatin", "Olou", "Sagbo",
      "Tchomogo", "Zohoun", "Adjovi", "Dakpogan", "Houngbedji", "Kponou", "Sohou", "Zinsou",
      "Aholou", "Bocco", "Chabi", "Dossa", "Edorh", "Fassinou", "Gnonlonfoun", "Hounsou",
      "Idrissou", "Josue", "Lawani", "Metonou", "Nassirou", "Ogou", "Padonou", "Quenum",
      "Rachidi", "Soglo", "Tchibozo", "Ubaldo", "Vigninou", "Wadagni", "Yessoufou", "Adjaho",
      "Baba", "Codjo", "Dangnon", "Egbeto", "Fagbohoun", "Gandonou", "Hounkponou", "Issa",
      "Jacques", "Kolawole", "Lokossou", "Medegan", "Nouatin", "Ouinsou", "Pognon", "Quenoum",
      "Rufino", "Sacca", "Tossou", "Vodounnon", "Wanibe", "Yarou", "Zomahoun", "Ahoyo",
      "Bello", "Chitou", "Djibril", "Ezin", "Gbedan",
    ],
  },
  Guatemala: {
    weight: 2,
    first: [
      "Carlos", "Jose", "Luis", "Rodrigo", "Marco", "Nicolas", "Oscar", "Jorge",
      "Antonio", "Rafael", "Jesus", "Fredy", "Kevin", "Alejandro", "Elias", "Gerardo",
      "Juan", "Pedro", "Erick", "Manuel", "Diego", "Cristian", "Aaron", "Byron",
      "Santiago", "Mateo", "Sebastian", "Emiliano", "Maximiliano", "Joaquin", "Benjamin", "Facundo",
      "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas", "Julian",
      "Federico", "Gonzalo", "Alonso", "Cristobal", "Esteban", "Fabian", "Gustavo", "Hernan",
      "Ivan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio", "Pablo", "Ramiro",
      "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio",
      "Ciro", "Damian", "Efrain", "Fermin", "Horacio", "Isidro", "Jonatan", "Lucio",
      "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin", "Rubio", "Nathaniel", "Jhonatan",
      "Wilson",
    ],
    last: [
      "Morales", "Lopez", "Ruiz", "Hernandez", "Perez", "Garcia", "Rodriguez", "Castillo",
      "Mendez", "Ramirez", "Santis", "Estrada", "Contreras", "Oliva", "Marroquin", "Cardona",
      "Alvarez", "Palencia", "Cabrera", "Barrios", "Chinchilla", "Figueroa", "Monterroso", "Quinonez",
      "Gonzalez", "Martinez", "Sanchez", "Vasquez", "Garrido", "Ixcoy", "Jocol", "Kestler",
      "Lemus", "Mazariegos", "Noriega", "Ordonez", "Portillo", "Quijivix", "Rosales", "Solares",
      "Tobar", "Urizar", "Velasquez", "Xicay", "Yanes", "Zapeta", "Ajanel", "Batres",
      "Calderon", "Duarte", "Escalante", "Franco", "Ibanez", "Juarez", "Lima", "Mejia",
      "Navas", "Ochoa", "Pacay", "Reyna", "Samayoa", "Tzunun", "Ucelo", "Villagran",
      "Yaxon", "Zavala", "Alvarado", "Boror", "Chavarria", "Dubon", "Fuentes", "Galindo",
      "Herrarte", "Ical",
    ],
  },
  "El Salvador": {
    weight: 2,
    first: [
      "Nelson", "Darwin", "Jairo", "Marvin", "Enrico", "Kevin", "Christian", "Ronald",
      "Bryan", "Mario", "Herbert", "Gerson", "Narciso", "Amando", "Denis", "Roberto",
      "Diego", "Ivan", "Joaquin", "Rodolfo", "Walter", "Oscar", "Salvador", "Nahun",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Benjamin", "Facundo",
      "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas", "Julian",
      "Federico", "Gonzalo", "Rodrigo", "Alonso", "Cristobal", "Esteban", "Fabian", "Gustavo",
      "Hernan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio", "Pablo", "Ramiro",
      "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio", "Ciro",
      "Damian", "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan", "Lucio",
      "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin", "Jefferson", "Styven", "Ronaldo",
    ],
    last: [
      "Cerritos", "Henriquez", "Ceren", "Zelaya", "Bonilla", "Portillo", "Menjivar", "Escobar",
      "Alas", "Rugamas", "Turcios", "Cruz", "Landaverde", "Sanchez", "Melgar", "Quintanilla",
      "Aguilar", "Chavez", "Duran", "Guevara", "Mejia", "Rivas", "Interiano", "Ventura",
      "Hernandez", "Martinez", "Rodriguez", "Gonzalez", "Lopez", "Ramirez", "Flores", "Reyes",
      "Diaz", "Alvarenga", "Barrera", "Campos", "Deras", "Erazo", "Fuentes", "Galdamez",
      "Hercules", "Iraheta", "Jovel", "Lemus", "Mancia", "Navarrete", "Orellana", "Perez",
      "Quijada", "Recinos", "Sorto", "Tobar", "Umana", "Vaquerano", "Zavaleta", "Argueta",
      "Bermudez", "Castellanos", "Dominguez", "Escalante", "Figueroa", "Guardado", "Hurtado", "Jimenez",
      "Larin", "Molina", "Nunez", "Osorio", "Palacios", "Ramos", "Salguero", "Trejo",
      "Urrutia", "Velasquez", "Zaldana", "Alfaro", "Bran", "Cornejo", "Delgado",
    ],
  },
  "Trinidad and Tobago": {
    weight: 2,
    first: [
      "Kevin", "Levi", "Alvin", "Khaleem", "Joevin", "Sheldon", "Aubrey", "Nathan",
      "Reon", "Daniel", "Marvin", "Neveal", "Justin", "Ryan", "Andre", "Trevin",
      "Duane", "Curtis", "Jesse", "Malcolm", "Shannon", "Tyrone", "Willis", "Kern",
      "Ataullah", "Cordell", "Densill", "Elton", "Fabian", "Gregory", "Hayden", "Isaiah",
      "Jamal", "Keron", "Leston", "Micah", "Noah", "Osei", "Prince", "Quincy",
      "Rondell", "Sedale", "Terrell", "Uriah", "Vaughn", "Wendell", "Akeem", "Brent",
      "Clyde", "Dwight", "Errol", "Fenton", "Garvin", "Hollis", "Ivan", "Joel",
      "Kwesi", "Lincoln", "Marlon", "Nkosi", "Orville", "Peter", "Roland", "Selwyn",
      "Trevor", "Ulric", "Victor", "Wesley", "Anton", "Basil", "Carlos", "Damian",
      "Everton", "Franklyn", "Gerard", "Hugh", "Jason", "Kenwyne", "Lyndon", "Michel",
    ],
    last: [
      "Garcia", "Jones", "Hyland", "Bateau", "Phillip", "Fenlon", "Hackshaw", "Toussaint",
      "Gonzales", "Charles", "Lewis", "Andrews", "Baptiste", "Boucaud", "Chase", "Dyer",
      "Edwards", "Guerra", "John", "Marcelle", "Peltier", "Williams", "Alexander", "Superville",
      "Joseph", "Thomas", "Roberts", "Sampson", "Ramdhan", "Singh", "Persad", "Maharaj",
      "Rampersad", "Bissessar", "Cooper", "Duncan", "Emmanuel", "Forde", "George", "Hodge",
      "Isaac", "Jack", "Khan", "La Foucade", "Modeste", "Noel", "Ottley", "Paul",
      "Quamina", "Rodney", "Solomon", "Trim", "Ulysses", "Valentine", "Warner", "Yorke",
      "Ali", "Baird", "Daniel", "Ford", "Gomez", "Henry", "James", "Julien",
      "Legerton", "Mohammed", "Nurse", "Ollivierre", "Pierre", "Ramsey", "Sealey", "Wharton",
      "Attong", "Boodoo", "Corbin", "Dolly", "Francois", "Griffith",
    ],
  },
  Fiji: {
    weight: 2,
    first: [
      "Setareki", "Iosefo", "Napolioni", "Sairusi", "Antonio", "Scott", "Praneel", "Ratu",
      "Meli", "Kolinio", "Epeli", "Waisake", "Simione", "Jale", "Tevita", "Alvin",
      "Beniamino", "Christopher", "Dave", "Filipe", "Josaia", "Manasa", "Peni", "Semi",
      "Sakaraia", "Marika", "Netani", "Osea", "Penioni", "Rusiate", "Samu", "Taniela",
      "Vilimoni", "Watisoni", "Apisai", "Emosi", "Ilaisa", "Joeli", "Kiniviliame", "Livai",
      "Mesake", "Nemani", "Oscar", "Rupeni", "Sekove", "Timoci", "Viliame", "Akuila",
      "Eroni", "Isikeli", "Jone", "Kalivati", "Laisenia", "Mosese", "Naca", "Onisimo",
      "Pauliasi", "Ravuama", "Semisi", "Tomasi", "Vuniani", "Amenatave", "Etuate", "Inoke",
      "Jekope", "Kelemedi", "Leone", "Malakai", "Nacanieli", "Orisi", "Poasa", "Ratunaisa",
      "Suliasi", "Waisale", "Aporosa", "Elia",
    ],
    last: [
      "Verma", "Naidu", "Baleinamau", "Tuivuna", "Tuisawau", "Rasova", "Dunadamu", "Ravonokula",
      "Waqanidrola", "Nawatu", "Ratudradra", "Bolatagane", "Cavubati", "Delana", "Koroi", "Lomani",
      "Matai", "Naicker", "Prasad", "Rokovada", "Singh", "Vosarogo", "Naiqama", "Tabua",
      "Sharma", "Kumar", "Chand", "Reddy", "Nand", "Raj", "Lal", "Ram",
      "Deo", "Goundar", "Bose", "Cakau", "Delai", "Erenavula", "Finau", "Gavidi",
      "Hazelman", "Ika", "Jokhan", "Kean", "Ledua", "Mataitoga", "Nawaqavou", "Osborne",
      "Puamau", "Qereqeretabua", "Raiwalui", "Seru", "Uluinayau", "Vakatawabai", "Waqa", "Yalimaiwai",
      "Bulivou", "Cavuilati", "Dakuwaqa", "Erasito", "Fatiaki", "Gonewai", "Halofaki", "Inoke",
      "Jione", "Kalouniviti", "Marama", "Nadolo", "Ovalau", "Pickering", "Ratunabuabua", "Saukuru",
      "Vuli", "Waqanivalu", "Yabaki", "Bola", "Cagilaba",
    ],
  },
  "Papua New Guinea": {
    weight: 2,
    first: [
      "Raymond", "Tommy", "Nigel", "David", "Michael", "Alwin", "Emmanuel", "Ronald",
      "Kolu", "Yagi", "Gimo", "Nicholas", "Felix", "Jacob", "Koriak", "Daniel",
      "Obert", "Philip", "Samuel", "Timothy", "Valentine", "Wesley", "Andrew", "Bill",
      "Cyril", "Dickson", "Elijah", "Fabian", "Gideon", "Harold", "Ian", "Jerry",
      "Kevin", "Lionel", "Marcus", "Norman", "Oscar", "Paul", "Quinton", "Ronny",
      "Steven", "Tobias", "Ulai", "Vincent", "Walter", "Aaron", "Brendan", "Charles",
      "Douglas", "Edward", "Francis", "Graham", "Henry", "Isaac", "John", "Kenny",
      "Leonard", "Micah", "Nathan", "Owen", "Peter", "Robert", "Simon", "Terry",
      "Vernon", "William", "Benny", "Clement",
    ],
    last: [
      "Semmy", "Dabinyaba", "Muta", "Foster", "Simon", "Warup", "Kaipu", "Aisa",
      "Bakani", "Daera", "Gerard", "Hebou", "Joseph", "Kepo", "Lepani", "Molean",
      "Nawi", "Pagan", "Reu", "Tovi", "Waine", "Yakasa", "Kimai", "Talusa",
      "Auri", "Bala", "Chikala", "Danga", "Elavo", "Gari", "Hagai", "Iamo",
      "Joe", "Kaupa", "Lohia", "Maino", "Nime", "Oala", "Pila", "Rama",
      "Sipa", "Tau", "Ubo", "Vagi", "Wari", "Yali", "Bage", "Cholai",
      "Dai", "Enoch", "Gena", "Hebo", "Ila", "Kila", "Loi", "Mea",
      "Nou", "Ona", "Pome", "Raka", "Sine", "Toua", "Vali", "Wame",
      "Yaki", "Boas", "Dogoro", "Eka", "Gima", "Heni", "Ipa", "Kori",
      "Lua", "Moka", "Nako", "Oma", "Pena", "Rau",
    ],
  },
};

// "Other Nations (combined)" bucket — a country is picked uniformly among
// these when the weighted roll lands in that combined slot.
export const OTHER_NATIONS: Record<string, { first: string[]; last: string[] }> = {
  Egypt: {
    first: [
      "Ahmed", "Mohamed", "Mahmoud", "Mostafa", "Omar", "Youssef", "Khaled", "Tarek",
      "Abdallah", "Amr", "Ayman", "Ehab", "Hany", "Hossam", "Islam", "Karim",
      "Marwan", "Nader", "Ramy", "Sherif", "Wael", "Yasser", "Ziad", "Fady",
      "Hazem", "Bassem", "Gamal", "Hesham", "Kareem", "Magdy", "Osama", "Sameh",
      "Tamer", "Waleed", "Zakaria", "Adel", "Bahaa", "Emad", "Fathi", "Ihab",
      "Mounir", "Nabil", "Raafat", "Salah", "Wagdy", "Yehia", "Abdelrahman", "Bilal",
      "Essam", "Farid", "Hamdi", "Ismail", "Loai", "Medhat", "Nasser", "Rashad",
      "Sabry", "Talaat", "Wesam", "Zeyad", "Anwar", "Diaa", "Galal", "Hussam",
    ],
    last: [
      "Hassan", "Ibrahim", "Mahmoud", "Abdelrahman", "Fathy", "Ramadan", "Shawky", "Kamal",
      "Abdelaziz", "Adel", "Ashour", "Badr", "Ezzat", "Farouk", "Fawzy", "Gaber",
      "Halim", "Mansour", "Nasser", "Rashad", "Sabry", "Samir", "Tawfik", "Zaki",
      "Mohamed", "Ali", "Hamdy", "Ismail", "Kamel", "Lotfy", "Nagy", "Othman",
      "Qassem", "Sayed", "Taha", "Wahba", "Yousef", "Abdelnaby", "Bakr", "Darwish",
      "Elshennawy", "Ghaly", "Helmy", "Ibrahem", "Kassem", "Labib", "Metwally", "Nassar",
      "Okasha", "Sobhy", "Wahid", "Yassin", "Zidan", "Abdelhamid", "Badawy", "Diab",
      "Elsayed", "Fahmy", "Gomaa", "Hosny", "Kadry", "Mahfouz", "Nabil", "Rezk",
      "Tolba", "Wagdy", "Younis", "Zohdy",
    ],
  },
  Tunisia: {
    first: [
      "Mohamed", "Ahmed", "Youssef", "Anis", "Bilel", "Hamza", "Seifeddine", "Oussama",
      "Aymen", "Bassem", "Chaker", "Firas", "Ghaith", "Hedi", "Iheb", "Khalil",
      "Marwen", "Mehdi", "Nassim", "Rami", "Skander", "Taha", "Wajdi", "Zied",
      "Mahmoud", "Mostafa", "Karim", "Tarek", "Amr", "Sherif", "Wael", "Hazem",
      "Ayman", "Fady", "Gamal", "Hesham", "Islam", "Kareem", "Magdy", "Nader",
      "Osama", "Ramy", "Sameh", "Tamer", "Waleed", "Yasser", "Zakaria", "Adel",
      "Bahaa", "Emad", "Fathi", "Hany", "Ihab", "Khaled", "Mounir", "Nabil",
      "Raafat", "Salah", "Wagdy", "Yehia", "Abdelrahman", "Bilal", "Essam", "Farid",
      "Hamdi", "Ismail", "Loai", "Medhat", "Nasser", "Rashad", "Sabry", "Talaat",
      "Wesam", "Zeyad", "Anwar", "Diaa", "Galal", "Hussam",
    ],
    last: [
      "Trabelsi", "Jebali", "Gharbi", "Mansouri", "Hammami", "Chebbi", "Dridi", "Ayari",
      "Abidi", "Baccouche", "Belhadj", "Ben Salah", "Bouazizi", "Chouchane", "Hamdi", "Jaziri",
      "Karoui", "Laabidi", "Mejri", "Nasri", "Ouertani", "Rekik", "Sassi", "Zouari",
      "Ben Ali", "Ferjani", "Chaouachi", "Khelifi", "Rebai", "Toumi", "Zouaoui", "Abdelli",
      "Essid", "Haddad", "Naceur", "Oueslati", "Riahi", "Slimani", "Tlili", "Yahyaoui",
      "Zaidi", "Amri", "Chaabane", "Daoudi", "Ellouze", "Fakhfakh", "Guesmi", "Hamrouni",
      "Jelassi", "Kacem", "Lahmar", "Msakni", "Nefzi", "Ouni", "Rezgui", "Sahli",
      "Tounsi", "Yaakoubi", "Zaouali", "Aloui", "Bouzid", "Chihi", "Dhaouadi", "Fitouri",
    ],
  },
  Chile: {
    first: [
      "Matias", "Benjamin", "Vicente", "Joaquin", "Cristobal", "Diego", "Felipe", "Ignacio",
      "Alonso", "Bastian", "Bruno", "Cristian", "Esteban", "Franco", "Gabriel", "Gonzalo",
      "Javier", "Lucas", "Martin", "Nicolas", "Pablo", "Rodrigo", "Sebastian", "Tomas",
      "Santiago", "Mateo", "Emiliano", "Maximiliano", "Facundo", "Thiago", "Bautista", "Valentin",
      "Lautaro", "Agustin", "Julian", "Federico", "Fabian", "Gustavo", "Hernan", "Ivan",
      "Leandro", "Marcelo", "Nahuel", "Octavio", "Ramiro", "Salvador", "Teodoro", "Ulises",
      "Ximeno", "Yago", "Aurelio", "Braulio", "Ciro", "Damian", "Efrain", "Fermin",
      "Gerardo", "Horacio", "Isidro", "Jonatan", "Lucio", "Mauricio", "Norberto", "Osvaldo",
      "Prospero", "Quintin", "Renato",
    ],
    last: [
      "Munoz", "Rojas", "Soto", "Contreras", "Silva", "Fuentes", "Espinoza", "Araya",
      "Aravena", "Bravo", "Carrasco", "Cortes", "Diaz", "Fuenzalida", "Gutierrez", "Herrera",
      "Lagos", "Morales", "Nunez", "Orellana", "Pizarro", "Reyes", "Tapia", "Valenzuela",
      "Sepulveda", "Torres", "Flores", "Castillo", "Vergara", "Riquelme", "Fernandez", "Jara",
      "Miranda", "Quezada", "Ramos", "Saavedra", "Toro", "Urrutia", "Yanez", "Zuniga",
      "Bustos", "Donoso", "Escobar", "Farias", "Gallardo", "Henriquez", "Ibanez", "Leiva",
      "Maldonado", "Navarrete", "Ortega", "Palma", "Quiroz", "Retamal", "Salinas", "Troncoso",
      "Vera", "Zamorano",
    ],
  },
  Peru: {
    first: [
      "Luis", "Jose", "Carlos", "Jorge", "Miguel", "Renzo", "Alonso", "Piero",
      "Andre", "Christian", "Diego", "Edison", "Fabio", "Gianluca", "Hernan", "Jean",
      "Joel", "Juan", "Manuel", "Marcos", "Paolo", "Sergio", "Wilder", "Rodrigo",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Cristobal", "Esteban", "Fabian", "Gustavo", "Ivan",
      "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio", "Pablo", "Ramiro", "Salvador",
      "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio", "Ciro",
      "Damian", "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan", "Lucio",
      "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin", "Yordy",
    ],
    last: [
      "Quispe", "Flores", "Huaman", "Chavez", "Rojas", "Torres", "Castillo", "Salazar",
      "Aguirre", "Alvarado", "Cabrera", "Cardenas", "Espinoza", "Gomez", "Guerrero", "Mamani",
      "Mendoza", "Palacios", "Ramos", "Reyna", "Sanchez", "Vasquez", "Vilca", "Zegarra",
      "Condori", "Vargas", "Cordova", "Paredes", "Zapata", "Bautista", "Ccama", "Delgado",
      "Escalante", "Farfan", "Gamarra", "Hinostroza", "Ipanaque", "Julca", "Lozano", "Meza",
      "Ninaquispe", "Olivares", "Palomino", "Quiroga", "Rivas", "Solano", "Tello", "Ubillus",
      "Valdivia", "Yupanqui", "Zevallos", "Alarcon", "Benites", "Camacho", "Davila", "Estrada",
      "Fuentes", "Grados", "Huaringa", "Izquierdo", "Landa", "Montoya", "Nieto", "Ordonez",
      "Pacheco",
    ],
  },
  Bolivia: {
    first: [
      "Juan", "Carlos", "Luis", "Marco", "Ronald", "Diego", "Jhasmani", "Rodrigo",
      "Alejandro", "Alvaro", "Bruno", "Danny", "Edwin", "Erwin", "Fernando", "Gabriel",
      "Gustavo", "Henry", "Jorge", "Leonel", "Marcelo", "Moises", "Nelson", "Ramiro",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Alonso", "Cristobal", "Esteban", "Fabian", "Hernan",
      "Ivan", "Javier", "Leandro", "Nahuel", "Octavio", "Pablo", "Salvador", "Teodoro",
      "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio", "Ciro", "Damian",
      "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan", "Lucio", "Mauricio",
      "Norberto", "Osvaldo", "Prospero", "Quintin",
    ],
    last: [
      "Mamani", "Quispe", "Flores", "Condori", "Choque", "Vargas", "Rojas", "Gutierrez",
      "Aguilar", "Apaza", "Arce", "Cespedes", "Colque", "Fernandez", "Justiniano", "Limachi",
      "Mendez", "Morales", "Poma", "Sanchez", "Ticona", "Villarroel", "Zurita", "Calderon",
      "Camacho", "Terceros", "Aguilera", "Baldivieso", "Cuellar", "Duran", "Eguez", "Hurtado",
      "Ibanez", "Limpias", "Melgar", "Nogales", "Ortiz", "Padilla", "Quiroga", "Roca",
      "Saucedo", "Tordoya", "Ustarez", "Vaca", "Yucra", "Zambrana", "Alvarez", "Ballivian",
      "Carvajal", "Dorado", "Escobar", "Ferrufino", "Gonzales", "Herrera", "Iriarte", "Jimenez",
      "Lopez", "Nunez", "Oropeza", "Pena", "Rivero", "Salvatierra", "Tapia", "Urquidi",
      "Velasco",
    ],
  },
  Iran: {
    first: [
      "Ali", "Reza", "Amir", "Hossein", "Mehdi", "Saeid", "Arman", "Pouya",
      "Abbas", "Ahmad", "Behnam", "Danial", "Ehsan", "Farhad", "Hamid", "Iman",
      "Kaveh", "Majid", "Milad", "Mohsen", "Navid", "Omid", "Peyman", "Vahid",
      "Mohammad", "Saeed", "Behzad", "Ghasem", "Javad", "Mahmoud", "Naser", "Rasoul",
      "Shahin", "Tohid", "Yousef", "Zaman", "Arash", "Babak", "Cyrus", "Davood",
      "Esmaeil", "Farshid", "Hadi", "Iraj", "Kamran", "Nima", "Payam", "Ramin",
      "Sasan", "Taghi", "Younes", "Ardeshir", "Dariush", "Farzad", "Hooman", "Kianoush",
      "Masoud", "Nader", "Parviz", "Rouzbeh", "Shahram", "Turaj", "Yaser",
    ],
    last: [
      "Hosseini", "Ahmadi", "Rezaei", "Moradi", "Jafari", "Kazemi", "Sadeghi", "Ebrahimi",
      "Abbasi", "Akbari", "Alavi", "Bagheri", "Fazli", "Ghasemi", "Hashemi", "Karimi",
      "Mohammadi", "Mousavi", "Naderi", "Rahimi", "Salehi", "Shirazi", "Tabatabaei", "Yousefi",
      "Alizadeh", "Ghorbani", "Iranpour", "Jalali", "Lotfi", "Omidi", "Pourali", "Qasemi",
      "Rostami", "Vaziri", "Yazdani", "Zare", "Danesh", "Eslami", "Farhadi", "Gholami",
      "Heydari", "Imani", "Javadi", "Khalili", "Mahmoudi", "Nazari", "Parsa", "Rafiei",
      "Taheri", "Vakili", "Zamani", "Amiri", "Bahrami", "Dadashi", "Emami", "Firouzi",
      "Habibi", "Kamali", "Mirzaei",
    ],
  },
  China: {
    first: [
      "Wei", "Jun", "Hao", "Lei", "Ming", "Bo", "Tao", "Bin",
      "Cheng", "Gang", "Guang", "Hui", "Jian", "Kai", "Long", "Peng",
      "Qiang", "Sheng", "Wen", "Xiang", "Yong", "Zhi", "Jie", "Yu",
      "Xin", "Yang", "Chao", "Dong", "Feng", "Nan", "Ping", "Rui",
      "Tian", "Zhen", "Da", "Fei", "Guo", "Heng", "Kun", "Liang",
      "Meng", "Ning", "Qi", "Ran", "Shan", "Tong", "Wu", "Xu",
      "Yi", "An", "Chen", "Du", "Fu", "Hong", "Jing", "Kang",
    ],
    last: [
      "Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao",
      "Cao", "Deng", "Feng", "Guo", "Han", "He", "Hu", "Lin",
      "Luo", "Ma", "Song", "Sun", "Tang", "Wu", "Xu", "Zhou",
      "Zhu", "Gao", "Zheng", "Liang", "Xie", "Yu", "Dong", "Xiao",
      "Cheng", "Cai", "Peng", "Pan", "Yuan", "Jiang", "Fan", "Shen",
      "Lu", "Jin", "Shi", "Yao", "Tan", "Fu", "Zeng", "Xiong",
      "Qin", "Bai", "Jia", "Mao", "Qian", "Ren", "Wei", "Xia",
    ],
  },
  India: {
    first: [
      "Arjun", "Rohan", "Rahul", "Vikram", "Aditya", "Karan", "Nikhil", "Sanjay",
      "Amit", "Ankit", "Deepak", "Gaurav", "Harish", "Kunal", "Manish", "Pranav",
      "Rajesh", "Ravi", "Rohit", "Sachin", "Siddharth", "Suresh", "Varun", "Vivek",
      "Aarav", "Vivaan", "Vihaan", "Sai", "Reyansh", "Krishna", "Ishaan", "Harsh",
      "Jatin", "Naveen", "Pankaj", "Tarun", "Umesh", "Yash", "Abhishek", "Bharat",
      "Chetan", "Dinesh", "Girish", "Hemant", "Jayant", "Kiran", "Lalit", "Mohit",
      "Nitin", "Praveen", "Ramesh", "Tushar", "Vinod", "Ajay", "Bhavesh", "Chirag",
      "Devendra", "Ganesh", "Hitesh", "Imran", "Jignesh", "Kamal", "Lokesh",
    ],
    last: [
      "Sharma", "Singh", "Kumar", "Patel", "Nair", "Das", "Reddy", "Verma",
      "Bhatt", "Chauhan", "Desai", "Gupta", "Iyer", "Jain", "Joshi", "Kapoor",
      "Malhotra", "Menon", "Mishra", "Pillai", "Rao", "Saxena", "Shetty", "Yadav",
      "Bose", "Chatterjee", "Banerjee", "Mukherjee", "Shah", "Mehta", "Chopra", "Trivedi",
      "Pandey", "Tiwari", "Agarwal", "Sinha", "Naidu", "Rathore", "Bhardwaj", "Dubey",
      "Goswami", "Khanna", "Lal", "Mathur", "Nayak", "Oberoi", "Prasad", "Raut",
      "Sethi", "Thakur", "Upadhyay", "Vyas", "Wagh", "Bhalla", "Dixit", "Kaul",
      "Sood",
    ],
  },
  Israel: {
    first: [
      "Noam", "Itai", "Yonatan", "Amit", "Omer", "Daniel", "Gal", "Idan",
      "Ariel", "Aviv", "Dor", "Eitan", "Eyal", "Guy", "Lior", "Maor",
      "Nadav", "Nir", "Ofir", "Oren", "Roi", "Shai", "Tomer", "Yuval",
      "Yarden", "Barak", "Dan", "Elad", "Matan", "Ron", "Sagi", "Tal",
      "Uri", "Yoav", "Ziv", "Adam", "Boaz", "Doron", "Erez", "Gilad",
      "Hen", "Ilan", "Liran", "Moshe", "Rami", "Shimon", "Tzvi", "Yair",
      "Assaf", "Ben", "Gadi", "Haim", "Itamar", "Lavi", "Meir", "Netanel",
      "Ofek", "Raz", "Shlomi", "Yaniv",
    ],
    last: [
      "Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Avraham", "Dahan", "Azoulay",
      "Amar", "Barak", "Ben David", "Elbaz", "Gabay", "Hadad", "Katz", "Malka",
      "Nissim", "Ohana", "Regev", "Sasson", "Shalom", "Tal", "Yosef", "Zohar",
      "Friedman", "Israeli", "Lev", "Moyal", "Nahmias", "Ohayon", "Perez", "Vaknin",
      "David", "Fadida", "Golan", "Hazan", "Ifrah", "Kadosh", "Lugasi", "Maman",
      "Ozeri", "Pinto", "Rahamim", "Turgeman", "Uzan", "Weiss", "Yaakov", "Zaguri",
      "Adler", "Baruch", "Dayan", "Eliyahu", "Gilboa", "Harari", "Kaplan", "Meir",
      "Segal", "Shapira",
    ],
  },
  "New Zealand": {
    first: [
      "Liam", "Jack", "Oliver", "Hunter", "Mason", "Blake", "Finn", "Toby",
      "Archie", "Ben", "Callum", "Cameron", "Cody", "Ethan", "Harry", "Jayden",
      "Josh", "Kane", "Luke", "Nathan", "Reece", "Ryan", "Tama", "Zane",
      "Tane", "Nikau", "Manaia", "Ari", "Kauri", "Rawiri", "Wiremu", "Hemi",
      "Ihaia", "Jaxon", "Kobe", "Leo", "Mikaere", "Noah", "Pita", "Quinn",
      "Reuben", "Samuel", "Theo", "Wilson", "Zion", "Aaron", "Dylan", "Eli",
      "George", "Harrison", "Isaac", "Jacob", "Kyle", "Owen", "Shaun", "Tyler",
      "Vaughn", "Wade", "Xander", "Zac", "Ashton", "Brayden", "Corey", "Damon",
      "Elliot", "Grayson", "Hayden", "Jesse", "Keegan", "Lucas", "Marcus",
    ],
    last: [
      "Wilson", "Thompson", "Anderson", "Walker", "Harris", "Ngata", "Parata", "Clarke",
      "Baker", "Bennett", "Carter", "Cooper", "Edwards", "Hall", "Kingi", "Mitchell",
      "Murray", "Rangi", "Reid", "Robinson", "Taylor", "Turner", "Whittaker", "Wiremu",
      "Smith", "Williams", "Brown", "Wright", "Martin", "Clark", "Waititi", "Rewi",
      "Tane", "Kahu", "Paora", "Hemi", "Mikaere", "Kereopa", "Tamati", "Whanau",
      "Ihaka", "Nikora", "Pere", "Ropata", "Tipene", "Wharekura", "Ashby", "Davies",
      "Fletcher", "Graham", "Hughes", "Jenkins", "Kelly", "Lewis", "Moore", "Nolan",
      "Palmer", "Stewart", "Vaughan", "Watson", "Young", "Baxter", "Coleman", "Dixon",
      "Ellis",
    ],
  },
  Jamaica: {
    first: [
      "Andre", "Damion", "Shane", "Ricardo", "Omar", "Devon", "Kemar", "Jerome",
      "Anthony", "Dwayne", "Javon", "Kadeem", "Marlon", "Nicholas", "Odane", "Oshane",
      "Rohan", "Shamar", "Tyrese", "Kimani", "Deshawn", "Rushane", "Alwyn", "Damar",
      "Tyreke", "Leon", "Nickoy", "Peter", "Shaquille", "Tarik", "Vaughn", "Wayne",
      "Alvas", "Brandon", "Courtney", "Ewan", "Fabian", "Garfield", "Horace", "Ian",
      "Jermaine", "Kevaughn", "Lamar", "Michael", "Nathaniel", "Owayne", "Patrick", "Romario",
      "Steven", "Trevor", "Ulric", "Vernon", "Winston", "Adrian", "Barrington", "Clive",
      "Delroy", "Everton", "Fitzroy", "Glenroy", "Hopeton", "Junior", "Karl", "Lloyd",
      "Mervin", "Norman", "Oral",
    ],
    last: [
      "Brown", "Williams", "Campbell", "Grant", "Reid", "Thompson", "Blake", "Morrison",
      "Anderson", "Bailey", "Barrett", "Clarke", "Dixon", "Ellis", "Francis", "Gordon",
      "Henry", "Johnson", "Lawrence", "McKenzie", "Palmer", "Powell", "Robinson", "Wright",
      "Smith", "Bennett", "Edwards", "Jackson", "Lewis", "Morgan", "Nelson", "Stewart",
      "Taylor", "Walker", "Chambers", "Ferguson", "Hall", "Irving", "King", "Nicholson",
      "Richards", "Simpson", "Allen", "Cole", "Davis", "Evans", "Foster", "Green",
      "Harris", "James", "Kelly", "Miller", "Murray", "Parker", "Roberts", "Scott",
      "Thomas", "Watson",
    ],
  },
  "Costa Rica": {
    first: [
      "Jose", "Carlos", "Luis", "Andres", "Esteban", "Randall", "Marco", "Kenneth",
      "Alonso", "Bryan", "Christian", "Daniel", "David", "Diego", "Elias", "Fernando",
      "Gerson", "Jonathan", "Juan", "Manuel", "Mauricio", "Ronald", "Sergio", "Joel",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Rodrigo", "Cristobal", "Fabian", "Gustavo", "Hernan",
      "Ivan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio", "Pablo", "Ramiro",
      "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio",
      "Ciro", "Damian", "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan",
      "Lucio", "Norberto", "Osvaldo", "Prospero", "Quintin", "Keylor", "Celso",
    ],
    last: [
      "Vargas", "Rodriguez", "Jimenez", "Mora", "Solano", "Chaves", "Rojas", "Salas",
      "Aguilar", "Alvarado", "Araya", "Brenes", "Calvo", "Campos", "Castro", "Cordero",
      "Gamboa", "Hernandez", "Madrigal", "Montero", "Quesada", "Ramirez", "Segura", "Zamora",
      "Campbell", "Ruiz", "Venegas", "Bolanos", "Duarte", "Elizondo", "Fonseca", "Granados",
      "Herrera", "Induni", "Jara", "Leal", "Navarro", "Obando", "Picado", "Torres",
      "Villalobos", "Delgado", "Esquivel", "Fallas", "Gomez", "Hidalgo", "Lopez", "Nunez",
      "Ortiz", "Prendas", "Quiros", "Sanchez", "Trejos", "Umana", "Valverde", "Wilson",
      "Zuniga", "Arias", "Bermudez",
    ],
  },
  Honduras: {
    first: [
      "Carlos", "Jorge", "Marvin", "Wilmer", "Selvin", "Edwin", "Jerry", "Oscar",
      "Alexander", "Bryan", "Douglas", "Elmer", "Erick", "Franklin", "Jonathan", "Kevin",
      "Luis", "Mario", "Michael", "Rigoberto", "Roger", "Walter", "Deybi", "Yustin",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Rodrigo", "Alonso", "Cristobal", "Esteban", "Fabian",
      "Gustavo", "Hernan", "Ivan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio",
      "Pablo", "Ramiro", "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago",
      "Aurelio", "Braulio", "Ciro", "Damian", "Efrain", "Fermin", "Gerardo", "Horacio",
      "Isidro", "Jonatan", "Lucio", "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin",
      "Alberth", "Denil", "Romell",
    ],
    last: [
      "Martinez", "Lopez", "Flores", "Mejia", "Castro", "Zelaya", "Padilla", "Espinal",
      "Amaya", "Bonilla", "Cruz", "Elvir", "Garcia", "Hernandez", "Izaguirre", "Lozano",
      "Maradiaga", "Murillo", "Palacios", "Pineda", "Rivera", "Sandoval", "Velasquez", "Discua",
      "Rodriguez", "Reyes", "Sanchez", "Ramirez", "Elis", "Figueroa", "Guevara", "Maldonado",
      "Nunez", "Oliva", "Quioto", "Sabillon", "Turcios", "Umanzor", "Acosta", "Chirinos",
      "Diaz", "Espinoza", "Fuentes", "Galindo", "Hercules", "Interiano", "Juarez", "Lagos",
      "Meza", "Ordonez", "Quintanilla", "Rosales", "Suazo", "Torres", "Vallecillo", "Zuniga",
      "Aguilar", "Benitez", "Carrasco", "Duarte", "Erazo", "Fajardo", "Guerrero", "Handal",
    ],
  },
  Panama: {
    first: [
      "Jose", "Luis", "Alberto", "Ricardo", "Armando", "Rolando", "Ismael", "Gabriel",
      "Abdiel", "Adalberto", "Alfredo", "Anibal", "Cristian", "Edgar", "Eric", "Fidel",
      "Harold", "Jorge", "Juan", "Marcos", "Michael", "Omar", "Rodrigo", "Ivan",
      "Santiago", "Mateo", "Sebastian", "Nicolas", "Emiliano", "Maximiliano", "Joaquin", "Benjamin",
      "Facundo", "Thiago", "Bautista", "Valentin", "Lautaro", "Agustin", "Ignacio", "Tomas",
      "Julian", "Federico", "Gonzalo", "Alonso", "Cristobal", "Esteban", "Fabian", "Gustavo",
      "Hernan", "Javier", "Leandro", "Marcelo", "Nahuel", "Octavio", "Pablo", "Ramiro",
      "Salvador", "Teodoro", "Ulises", "Vicente", "Ximeno", "Yago", "Aurelio", "Braulio",
      "Ciro", "Damian", "Efrain", "Fermin", "Gerardo", "Horacio", "Isidro", "Jonatan",
      "Lucio", "Mauricio", "Norberto", "Osvaldo", "Prospero", "Quintin",
    ],
    last: [
      "Gonzalez", "Rodriguez", "Perez", "Castillo", "Sanchez", "Aguilar", "Beitia", "Camargo",
      "Arauz", "Barria", "Carrasquilla", "Cedeno", "Cordoba", "Escobar", "Fajardo", "Guerra",
      "Machado", "Miranda", "Murillo", "Ortega", "Quintero", "Renteria", "Samaniego", "Tejada",
      "Martinez", "Gomez", "Barcenas", "Torres", "Arroyo", "Baloy", "Diaz", "Godoy",
      "Henriquez", "Ibarra", "Jaen", "Lombardo", "Navarro", "Ovalle", "Palacios", "Quiroz",
      "Rivera", "Urriola", "Vega", "Waterman", "Yanguez", "Zamora", "Bonilla", "Delgado",
      "Espinosa", "Flores", "Hernandez", "Iglesias", "Jimenez", "Lopez", "Mendoza", "Nunez",
      "Pimentel", "Solis", "Tunon", "Valdes", "Young", "Alvarado",
    ],
  },
  Zambia: {
    first: [
      "Emmanuel", "Chanda", "Mwape", "Kelvin", "Lubinda", "Gift", "Brian", "Moses",
      "Aaron", "Andrew", "Charles", "Dennis", "Enock", "Isaac", "Jacob", "Kabaso",
      "Kennedy", "Lameck", "Peter", "Rodgers", "Simon", "Mubita", "Chola", "Musonda",
      "Joseph", "Samuel", "David", "John", "Daniel", "Michael", "Patrick", "Francis",
      "George", "Henry", "James", "Lawrence", "Martin", "Nicholas", "Oliver", "Philip",
      "Richard", "Stephen", "Thomas", "Victor", "William", "Anthony", "Benson", "Collins",
      "Edwin", "Felix", "Gideon", "Harrison", "Ian", "Jackson", "Lewis", "Nelson",
      "Owen", "Paul", "Reuben", "Timothy", "Vincent", "Wilson", "Alfred", "Cyprian",
      "Douglas", "Elias", "Fredrick", "Gerald", "Hillary", "Innocent",
    ],
    last: [
      "Banda", "Phiri", "Mwansa", "Tembo", "Zulu", "Mulenga", "Chirwa", "Musonda",
      "Bwalya", "Chanda", "Chileshe", "Kangwa", "Katongo", "Lungu", "Mumba", "Mwanza",
      "Sakala", "Sichone", "Simfukwe", "Zimba", "Kalunga", "Mwila", "Nkonde", "Siame",
      "Chilufya", "Daka", "Kalaba", "Ngoma", "Sinkala", "Kampamba", "Mbewe", "Nkhoma",
      "Kunda", "Mwape", "Njobvu", "Simukonda", "Chipimo", "Kasonde", "Mvula", "Nyirenda",
      "Sikazwe", "Chishimba", "Nsofwa", "Sinyangwe", "Chola", "Kaunda", "Mwewa", "Nyambe",
      "Siwale", "Chungu", "Kayombo", "Nyondo", "Sondashi", "Chikwanda", "Kabwe", "Mubanga",
      "Namukolo", "Silwamba", "Chiluba", "Kalusha", "Mukuka", "Ndhlovu", "Sikombe", "Chibwe",
    ],
  },
  Kenya: {
    first: [
      "Brian", "Kevin", "Dennis", "Collins", "Victor", "Eric", "Samuel", "Joseph",
      "Anthony", "Bernard", "Charles", "David", "Duncan", "Elijah", "Francis", "George",
      "James", "John", "Kelvin", "Michael", "Patrick", "Paul", "Peter", "Stephen",
      "Emmanuel", "Daniel", "Henry", "Isaac", "Lawrence", "Martin", "Nicholas", "Oliver",
      "Philip", "Richard", "Thomas", "William", "Benson", "Edwin", "Felix", "Gideon",
      "Harrison", "Ian", "Jackson", "Kennedy", "Lewis", "Moses", "Nelson", "Owen",
      "Reuben", "Simon", "Timothy", "Vincent", "Wilson", "Alfred", "Cyprian", "Douglas",
      "Elias", "Fredrick", "Gerald", "Hillary", "Innocent",
    ],
    last: [
      "Otieno", "Mwangi", "Kamau", "Ochieng", "Njoroge", "Kiprop", "Wafula", "Mutua",
      "Barasa", "Cheruiyot", "Gitau", "Kariuki", "Kimani", "Kiplagat", "Maina", "Muturi",
      "Ndungu", "Nyaga", "Odhiambo", "Omondi", "Onyango", "Ouma", "Wanjala", "Waweru",
      "Kipchumba", "Owino", "Hassan", "Juma", "Karanja", "Langat", "Ochieno", "Rotich",
      "Simiyu", "Tanui", "Yego", "Bett", "Chepkwony", "Gathoni", "Ireri", "Koech",
      "Lagat", "Ngugi", "Osoro", "Ruto", "Sang", "Too", "Wekesa", "Bosire",
      "Chege", "Gikonyo", "Irungu", "Kibet", "Kones", "Mbugua", "Mwenda", "Opiyo",
      "Sitati", "Wanyonyi",
    ],
  },
  Gabon: {
    first: [
      "Denis", "Bruno", "Guy", "Serge", "Herve", "Franck", "Ulrich", "Yannis",
      "Alain", "Andre", "Cedric", "Christian", "Didier", "Fabrice", "Gaston", "Jean",
      "Johann", "Landry", "Lloyd", "Marcel", "Patrick", "Rodrigue", "Stephane", "Axel",
      "Ibrahim", "Mamadou", "Ousmane", "Abdoulaye", "Cheikh", "Modou", "Alassane", "Bakary",
      "Boubacar", "Lamine", "Moussa", "Seydou", "Amadou", "Souleymane", "Youssouf", "Karim",
      "Idrissa", "Sekou", "Aliou", "Bocar", "Demba", "Fode", "Habib", "Issa",
      "Kalidou", "Malick", "Ndiaga", "Omar", "Pape", "Saliou", "Tidiane", "Yaya",
      "Adama", "Bassirou", "Cherif", "Djibril", "Elhadji", "Fallou", "Gora", "Hamidou",
      "Insa", "Jules", "Khadim", "Landing", "Mor", "Nfally", "Oumar", "Pathe",
      "Salif", "Thierno", "Waly", "Yankuba", "Zale", "Baba", "Cheikhou", "Dame",
    ],
    last: [
      "Ondo", "Nzue", "Moussavou", "Obiang", "Mba", "Ekomy", "Ivanga", "Ndong",
      "Assele", "Bekale", "Essono", "Koumba", "Makaya", "Mengue", "Mihindou", "Nguema",
      "Obame", "Ovono", "Bouanga", "Ditsoga", "Mabika", "Ndoumbe", "Nzigou", "Poaty",
      "Mintsa", "Ibinga", "Lendoye", "Mabicka", "Nyare", "Rerambyath", "Sima", "Tsoumou",
      "Boussougou", "Danguy", "Ekomie", "Fambo", "Gnigone", "Iloko", "Kassa", "Loussou",
      "Madoungou", "Ogandaga", "Pambo", "Rembangouet", "Samba", "Toung", "Yembit", "Divassa",
      "Engonga", "Fabrice", "Guembou", "Iyabi", "Kombila", "Lebomo", "Ndemba", "Ondounda",
      "Pendy", "Rougou", "Souza", "Tchibinda", "Yamba", "Bibang", "Dikoumba", "Gassita",
      "Ibouanga",
    ],
  },
  Angola: {
    first: [
      "Joao", "Pedro", "Manuel", "Antonio", "Domingos", "Helder", "Wilson", "Edmilson",
      "Alberto", "Carlos", "Eduardo", "Fernando", "Gelson", "Herculano", "Jorge", "Jose",
      "Mario", "Miguel", "Nelson", "Paulo", "Rui", "Zito", "Bruno", "Osvaldo",
      "Bento", "Custodio", "Danilo", "Filipe", "Gaspar", "Isidro", "Jacinto", "Ladislau",
      "Mateus", "Paulino", "Quim", "Silvio", "Tiago", "Valdemar", "Xavier", "Zeca",
      "Adelino", "Celso", "Dionisio", "Emiliano", "Fabio", "Gilberto", "Horacio", "Inacio",
      "Leonel", "Marcos", "Nuno", "Octavio", "Placido", "Ricardo", "Sebastiao", "Teodoro",
      "Ulisses", "Vasco", "Yuri", "Zacarias", "Amadeu",
    ],
    last: [
      "dos Santos", "Fernandes", "Cabral", "Sebastiao", "Neto", "Gomes", "Lourenco", "Panzo",
      "Andre", "Antunes", "Dala", "Dias", "Manuel", "Mbala", "Mendonca", "Paulo",
      "Santana", "Silva", "Tavares", "Zola", "Bastos", "Kiala", "Mateus", "Nascimento",
      "Da Silva", "Pereira", "Cardoso", "Antonio", "Domingos", "Bumba", "Ekuikui", "Freitas",
      "Gaspar", "Hebo", "Inacio", "Joao", "Kissila", "Lelo", "Macaia", "Nzuzi",
      "Ovelha", "Quissanga", "Rocha", "Tomas", "Ussumane", "Vunge", "Wilson", "Xavier",
      "Afonso", "Chissola", "Eduardo", "Francisco", "Henriques", "Isaac", "Jamba", "Kialunda",
      "Lopes", "Miguel", "Oliveira", "Pinto", "Quinta", "Rodrigues", "Simao", "Teixeira",
      "Vieira", "Zinga", "Buta",
    ],
  },
  Tanzania: {
    first: [
      "Juma", "Hamisi", "Rashidi", "Selemani", "Abdallah", "Issa", "Hassan", "Baraka",
      "Ally", "Amani", "Bakari", "Emmanuel", "Erasto", "Farid", "Ibrahim", "John",
      "Mohamed", "Musa", "Peter", "Salum", "Shaaban", "Simon", "Yusuph", "Nassoro",
      "Joseph", "Samuel", "David", "Daniel", "Michael", "Patrick", "Charles", "Francis",
      "George", "Henry", "Isaac", "James", "Kelvin", "Lawrence", "Martin", "Nicholas",
      "Oliver", "Philip", "Richard", "Stephen", "Thomas", "Victor", "William", "Anthony",
      "Benson", "Collins", "Dennis", "Edwin", "Felix", "Gideon", "Harrison", "Ian",
      "Jackson", "Kennedy", "Lewis", "Moses", "Nelson", "Owen", "Paul", "Reuben",
      "Timothy", "Vincent", "Wilson", "Alfred", "Brian", "Cyprian", "Douglas", "Elias",
      "Fredrick", "Gerald", "Hillary", "Innocent",
    ],
    last: [
      "Said", "Mushi", "Massawe", "Shayo", "Kimaro", "Swai", "Temba", "Lyimo",
      "Kessy", "Msuya", "Ngassa", "Nyoni", "Rashid", "Sanga", "Shabani", "Tesha",
      "Kimario", "Malongo", "Mbwana", "Mkwasa", "Mlay", "Mwakyembe", "Ndege", "Semwaiko",
      "Mwakalebela", "Mnata", "Samatta", "Bocco", "Kapombe", "Msuva", "Mwinyi", "Ulimwengu",
      "Chama", "Deo", "Fataki", "Gama", "Hamis", "Issa", "Juma", "Kamote",
      "Lusajo", "Mgunda", "Omary", "Peter", "Salum", "Tegete", "Ussi", "Wambura",
      "Yahya", "Zahera", "Abdallah", "Bakari", "Chuma", "Daudi", "Emmanuel", "Fundi",
      "Gwao", "Haruna", "Idd", "Jumanne", "Kibwana", "Ndaki", "Osika", "Pius",
      "Ramadhani", "Shomari", "Tumaini", "Uledi", "Waziri", "Yusuph", "Zubeda", "Bahati",
      "Charles", "Damian",
    ],
  },
  "South Africa": {
    first: [
      "Sipho", "Thabo", "Bongani", "Themba", "Lucky", "Katlego", "Sibusiso", "Andile",
      "Ayanda", "Bandile", "Kabelo", "Kagiso", "Lebo", "Mandla", "Mpho", "Musa",
      "Nkosinathi", "Oupa", "Sandile", "Sifiso", "Siyabonga", "Thulani", "Tshepo", "Vusi",
      "Lebogang", "Bafana", "Dumisani", "Elias", "Fortune", "Gift", "Hlompho", "Innocent",
      "Jabulani", "Percy", "Refiloe", "Teboho", "Wandile", "Xolani", "Zakhele", "Aubrey",
      "Bradley", "Clayton", "Daine", "Ernst", "Fagrie", "Granwald", "Hendrick", "Itumeleng",
      "Jethro", "Keagan", "Lyle", "Morgan", "Neo", "Ovidy", "Phillip", "Reeve",
      "Tercious", "Vincent", "Wayde", "Yusuf", "Zuko", "Aphiwe",
    ],
    last: [
      "Dlamini", "Nkosi", "Khumalo", "Mokoena", "Ndlovu", "Mahlangu", "Sithole", "Mabaso",
      "Mabena", "Mahlambi", "Maluleke", "Masango", "Mbatha", "Mkhize", "Mnguni", "Molefe",
      "Motaung", "Mthembu", "Ngcobo", "Nhlapo", "Radebe", "Zwane", "Sibanda", "Tshabalala",
      "Mokwena", "Zungu", "Shabalala", "Vilakazi", "Xulu", "Zulu", "Baloyi", "Cele",
      "Dube", "Gumede", "Hlatshwayo", "Jali", "Kekana", "Lekgwathi", "Nene", "Phiri",
      "Sangweni", "Thwala", "Vilankulu", "Zuma", "Booysen", "Daniels", "Fredericks", "Grobler",
      "Isaacs", "Jacobs", "Kruger", "Links", "Meyer", "Naidoo", "Petersen", "Rossouw",
      "Smit", "Titus", "Van Wyk", "Williams", "Adams", "Botha", "Coetzee", "De Villiers",
      "Erasmus", "Fourie", "Govender",
    ],
  },
  Kosovo: {
    first: [
      "Arber", "Besart", "Endrit", "Fisnik", "Granit", "Leart", "Valon", "Blerim",
      "Agon", "Albin", "Ardian", "Arian", "Arlind", "Artan", "Astrit", "Behar",
      "Bekim", "Besnik", "Burim", "Dardan", "Driton", "Egzon", "Ermal", "Fatmir",
      "Florent", "Gazmend", "Ilir", "Jeton", "Kushtrim", "Labinot", "Liridon", "Mergim",
      "Muhamet", "Rron", "Shpend", "Valmir",
      "Donis", "Edon", "Fidan", "Herolind", "Ibrahim", "Kastriot", "Lirim", "Nderim",
      "Orhan", "Petrit", "Qendrim", "Rrahman", "Trim", "Valdrin", "Xhevat", "Ylber",
      "Zymer", "Enis", "Faton", "Gezim", "Haxhi", "Kreshnik", "Milot", "Naser",
      "Osman", "Perparim", "Skender", "Taulant", "Vlora", "Xhavit", "Yll", "Zenel",
      "Blerton", "Flamur", "Gentrit", "Hazir", "Isuf", "Kujtim", "Leotrim", "Nexhat",
    ],
    last: [
      "Krasniqi", "Berisha", "Gashi", "Hoxha", "Shala", "Kastrati", "Morina", "Rexhepi",
      "Ahmeti", "Aliu", "Avdiu", "Bajrami", "Bekaj", "Bytyqi", "Dervishi", "Elshani",
      "Fazliu", "Gjocaj", "Halimi", "Hasani", "Ibrahimi", "Jashari", "Kelmendi", "Limani",
      "Maloku", "Musliu", "Nika", "Osmani", "Qerimi", "Rama", "Sadiku", "Selimi",
      "Zeqiri", "Beqiri", "Haziri", "Statovci",
      "Hoti", "Nuhiu", "Peci", "Rrahmani", "Thaci", "Ukaj", "Veliu", "Xhemajli",
      "Gjoka", "Ismajli", "Mustafa", "Nikqi", "Palushi", "Tahiri", "Uka", "Vokrri",
      "Zeka", "Dedaj", "Emini", "Ferizi", "Grabovci", "Jusufi", "Kryeziu", "Loshaj",
      "Murati", "Nimani", "Pireva", "Salihu",
    ],
  },
  "Ivory Coast": {
    first: ["Serge", "Yaya", "Wilfried", "Franck", "Cheick", "Ibrahim", "Seydou", "Max"],
    last: ["Kouame", "Toure", "Kone", "Bamba", "Gadji", "Yao", "Coulibaly", "Zoro"],
  },
  Greece: {
    first: [
      "Giorgos", "Dimitris", "Kostas", "Nikos", "Vasilis", "Panagiotis", "Christos", "Stelios",
      "Alexandros", "Andreas", "Anestis", "Antonis", "Apostolos", "Charalampos", "Dionysis", "Evangelos",
      "Fotis", "Grigoris", "Ilias", "Ioannis", "Lefteris", "Manolis", "Michalis", "Nektarios",
      "Pavlos", "Petros", "Sotiris", "Spyros", "Stavros", "Thanasis", "Theodoros", "Yiannis",
      "Stefanos", "Babis", "Haris", "Iasonas", "Kyriakos", "Marios", "Odysseas", "Rigas",
      "Tasos", "Vangelis", "Zisis", "Achilleas", "Ektoras", "Filippos", "Gerasimos", "Kimon",
      "Lambros", "Menelaos", "Nikiforos", "Orestis", "Periklis", "Themis", "Vaggelis", "Xenofon",
      "Diomidis", "Efthymios", "Iakovos", "Leonidas",
      // Greece became a home league too — same reason as Serbia above. It stays
      // in OTHER_NATIONS rather than moving to NATIONALITIES on purpose:
      // TAIL_BASE is built from NATIONALITIES + OTHER_NATIONS, so moving it
      // would re-weight the "Rest of the World" tail for every league in every
      // existing save. Only the pools grew.
      "Akis", "Alkis", "Anargyros", "Angelos", "Argyris", "Aristidis", "Chrisovalantis",
      "Damianos", "Dinos", "Efstratios", "Emmanouil", "Epaminondas", "Evripidis", "Fanis",
      "Gregorios", "Harilaos", "Isidoros", "Kleanthis", "Konstantinos", "Kosmas", "Lazaros",
      "Loukas", "Markos", "Miltiadis", "Nikolaos", "Notis", "Panos", "Paraskevas",
      "Polychronis", "Prodromos", "Savvas", "Simos", "Socratis", "Takis", "Telemachos",
      "Thomas", "Vasileios", "Zacharias",
    ],
    last: [
      "Papadopoulos", "Nikolaou", "Georgiou", "Vlachos", "Karatzas", "Samaras", "Antoniou", "Christodoulou",
      "Alexopoulos", "Anagnostou", "Apostolou", "Dimitriou", "Economou", "Ioannou", "Karagiannis", "Katsaros",
      "Konstantinidis", "Makris", "Michailidis", "Nikolaidis", "Panagiotou", "Papageorgiou", "Papanikolaou", "Pappas",
      "Petridis", "Sideris", "Spanos", "Stavrou", "Theodorou", "Triantafyllou", "Vasileiou", "Zafeiriou",
      "Papadakis", "Konstantinou", "Christou", "Alexiou", "Andreou", "Athanasiou", "Chatzis", "Dellas",
      "Fotiadis", "Gerakis", "Iliadis", "Kalogeras", "Lambrou", "Oikonomou", "Raptis", "Tsiolis",
      "Xenakis", "Zafiris", "Angelopoulos", "Bakogiannis", "Diamantis", "Fragkos", "Galanis", "Kyriakidis",
      "Leventis", "Manolas", "Nikas", "Petrou", "Roussos", "Vergos", "Zervas", "Adamidis",
      "Boutaris", "Drosos", "Filippidis", "Kondylis",
      "Avramidis", "Chatzigiannis", "Dendias", "Emmanouilidis", "Fountoulis", "Gianniotis",
      "Grigoriadis", "Kalaitzidis", "Kanellopoulos", "Karalis", "Kefalas", "Kokkinos",
      "Kolokotronis", "Kourtis", "Ladas", "Lekkas", "Liakos", "Malamas", "Mavridis",
      "Mitropoulos", "Moraitis", "Notaras", "Panagopoulos", "Papaioannou", "Paschalidis",
      "Politis", "Sakellariou", "Sarris", "Sofianos", "Stamatiadis", "Terzis", "Tsakiris",
      "Vlahakis", "Zoumboulis",
    ],
  },
  "Cape Verde": {
    first: [
      "Nuno", "Ricardo", "Jorge", "Garry", "Kenny", "Dylan", "Adilson", "Bruno",
      "Carlos", "Celso", "Edmilson", "Elvis", "Fabio", "Gilson", "Hernani", "Ivan",
      "Joao", "Julio", "Leandro", "Manuel", "Marco", "Mario", "Nelson", "Odair",
      "Paulo", "Rui", "Sandro", "Steven", "Vagner", "Wilson", "Zito", "Djair",
      "Djaniny", "Jamiro", "Kevin", "Vozinha", "Alex", "Helio", "Ianique", "Nivaldo",
      "Patrick", "Roberto", "Sidney", "Tiago", "Ailton", "Bebe", "Claudio", "Danilo",
      "Fernando", "Gelson", "Heldon", "Luis", "Osvaldo", "Pedro", "Silvio", "Toni",
      "Valdo", "Wanderson", "Benchimol", "Dario", "Eurico", "Flavio", "Gilberto",
    ],
    last: [
      "Tavares", "Furtado", "Lopes", "Semedo", "Rodrigues", "Fernandes", "Andrade", "Varela",
      "Almeida", "Barbosa", "Brito", "Cabral", "Correia", "Costa", "Delgado", "Duarte",
      "Evora", "Gomes", "Lima", "Livramento", "Mendes", "Monteiro", "Moreira", "Neves",
      "Pereira", "Pina", "Ramos", "Rocha", "Santos", "Silva", "Veiga", "Borges",
      "Fortes", "Oliveira", "Sanches", "Teixeira", "Martins", "Nascimento", "Sousa", "Vieira",
      "Amado", "Baptista", "Dias", "Ferreira", "Graca", "Leite", "Pinto", "Reis",
      "Soares", "Vaz", "Cardoso", "Estrela", "Freitas", "Miranda",
    ],
  },
  "Guinea-Bissau": {
    first: [
      "Mama", "Frederic", "Carlos", "Mamadu", "Bura", "Sori", "Abel", "Alfa",
      "Braima", "Bubacar", "Domingos", "Ernesto", "Fode", "Jose", "Malam", "Marciano",
      "Mario", "Nelson", "Paulo", "Samba", "Seco", "Tomas", "Umaro", "Iaguba",
      "Ibrahim", "Mamadou", "Ousmane", "Abdoulaye", "Cheikh", "Modou", "Alassane", "Bakary",
      "Boubacar", "Lamine", "Moussa", "Seydou", "Amadou", "Souleymane", "Youssouf", "Karim",
      "Idrissa", "Sekou", "Aliou", "Bocar", "Demba", "Habib", "Issa", "Kalidou",
      "Malick", "Ndiaga", "Omar", "Pape", "Saliou", "Tidiane", "Yaya", "Adama",
      "Bassirou", "Cherif", "Djibril", "Elhadji", "Fallou", "Gora", "Hamidou", "Insa",
      "Jules", "Khadim", "Landing", "Mor", "Nfally", "Oumar", "Pathe", "Salif",
      "Thierno", "Waly", "Yankuba", "Zale", "Baba", "Cheikhou", "Dame",
    ],
    last: [
      "Balde", "Mendy", "Embalo", "Cande", "Djalo", "Na Silva", "Indjai", "Camara",
      "Barbosa", "Biai", "Cassama", "Co", "Correia", "Dabo", "Danfa", "Gomes",
      "Injai", "Mane", "Nanque", "Nhaga", "Pereira", "Sanha", "Seidi", "Vaz",
      "Na Fafe", "Vieira", "Bacar", "Da Costa", "Fernandes", "Gadiaga", "Handem", "Imbana",
      "Jalo", "Kamara", "Lopes", "Ocante", "Quade", "Rodrigues", "Sambu", "Tavares",
      "Umaro", "Varela", "Yala", "Faty", "Gomis", "Have", "Jassi", "Keita",
      "Lima", "Mendes", "Oliveira", "Pinto", "Quinta", "Ramos", "Semedo", "Uri",
      "Wague", "Yaya", "Baio", "Cabral",
    ],
  },
};

// Sentinel key inside a league weight table standing for the combined
// "Rest of the World" share — when the weighted roll lands here, a nation is
// drawn from that league's tail pool (every nation NOT named in the table),
// weighted by its baseline frequency (see restPoolFor).
const REST = "__REST__";

/**
 * Per-league (home-country) nationality distributions, as relative weights
 * calibrated from real top-flight squad breakdowns (CIES-style). Each named
 * nation's weight is its stated percentage × 10; the REST sentinel's weight
 * is the league's "Rest of the World (Combined)" percentage × 10. Because
 * the source percentages don't sum to exactly 100 (rounding), the realized
 * shares are these weights normalized to the table total — the *relative*
 * proportions are preserved exactly, which is what matters.
 *
 * A club generates and draws youth from its own country's table. The
 * no-homeCountry / unknown-country path (global free agency, and any caller
 * that doesn't know a club's country) falls back to England's table — the
 * same "England-flavored" default the flat pool always was, just recalibrated
 * to the real EPL breakdown.
 *
 * Every named nation here has a name pool in NATIONALITIES, OTHER_NATIONS or
 * UNLISTED_NATIONALITIES. Türkiye maps to the existing "Turkey" entry;
 * Kosovo's, Greece's and Israel's pools live in OTHER_NATIONS, and Northern
 * Ireland's in UNLISTED_NATIONALITIES.
 *
 * A country playing in the world MUST have an entry here. There is no error
 * for a missing one — drawNationality falls back to England's table, so the
 * new league quietly fills up with English players and nothing fails.
 */
export const LEAGUE_NATIONALITY_WEIGHTS: Record<string, Record<string, number>> = {
  England: {
    England: 394, France: 63, Brazil: 63, Netherlands: 60, Spain: 35, Germany: 30,
    Portugal: 28, Argentina: 25, Belgium: 25, Wales: 23, Italy: 22, Denmark: 22, Scotland: 22,
    [REST]: 210,
  },
  Spain: {
    Spain: 618, Argentina: 39, France: 26, Morocco: 26, Uruguay: 24, Brazil: 21,
    Netherlands: 16, Portugal: 14, Senegal: 10, Cameroon: 10, Nigeria: 10, England: 10,
    Sweden: 8, Germany: 8, Italy: 8, Colombia: 6, Mexico: 6, Japan: 6, Croatia: 6,
    [REST]: 144,
  },
  Italy: {
    Italy: 387, France: 52, Spain: 44, Netherlands: 26, Argentina: 26, Brazil: 23,
    Poland: 22, Croatia: 20, Serbia: 20, Denmark: 19, Sweden: 19, Portugal: 18, Belgium: 18,
    England: 15, Morocco: 15, Germany: 15,
    [REST]: 240,
  },
  Germany: {
    Germany: 440, France: 59, Austria: 52, Denmark: 34, Switzerland: 29, Japan: 27,
    Belgium: 23, "United States": 23, Netherlands: 22, Portugal: 22, Croatia: 20, Brazil: 16,
    Norway: 14, Sweden: 14, Argentina: 13, Italy: 13, Turkey: 13, Nigeria: 13,
    "Czech Republic": 13, Kosovo: 11, England: 11, Algeria: 11, Serbia: 11,
    [REST]: 65,
  },
  // Ligue 1: strong French base, then a Francophone West/North African tail
  // (Senegal/Ivory Coast/Morocco/Mali/Algeria/Cameroon) unique to French
  // football, plus Belgium/Portugal as developmental neighbours.
  France: {
    France: 556, Senegal: 81, "Ivory Coast": 51, Morocco: 42, Belgium: 32, Mali: 32,
    Algeria: 32, Portugal: 32, England: 26, Cameroon: 26, Brazil: 24, Ghana: 24,
    Argentina: 18, Nigeria: 18, Denmark: 16, Switzerland: 16, Netherlands: 14,
    [REST]: 81,
  },
  // Primeira Liga: heavily international but overwhelmingly Brazilian, then
  // Spain and the PALOP (Portuguese-speaking African) nations Angola/Cape
  // Verde/Guinea-Bissau — the league's distinctive cultural pipelines.
  Portugal: {
    Portugal: 448, Brazil: 234, Spain: 99, France: 44, Uruguay: 24, Colombia: 20,
    Greece: 18, Netherlands: 18, Angola: 18, Argentina: 16, Nigeria: 16,
    "Ivory Coast": 16, "Cape Verde": 14, Sweden: 14, "Guinea-Bissau": 14,
    England: 14, Senegal: 14, Morocco: 12,
    [REST]: 72,
  },
  // Jupiler Pro League: over 61% foreign — Europe's most multi-channel trading
  // hub. A large French intake, then pipelines no other league here has: Japan
  // (the biggest Japanese contingent in Europe) and a broad West/North African
  // spread, plus DR Congo reflecting Belgium's own diaspora.
  Belgium: {
    Belgium: 383, France: 95, Japan: 52, Senegal: 47, Morocco: 41, Germany: 36,
    "Ivory Coast": 34, Netherlands: 28, England: 28, Nigeria: 24, Denmark: 24, "DR Congo": 21,
    Ghana: 16, Sweden: 16, Switzerland: 16, Portugal: 13, Ecuador: 13, Serbia: 10, Guinea: 10,
    Cameroon: 10, Spain: 10, Algeria: 10, Austria: 10,
    [REST]: 53,
  },
  // Super Lig: roughly an even domestic/foreign split, with the foreign half
  // blending Brazil, Francophone West Africa and a Balkan tail (Kosovo, Bosnia,
  // Albania, Romania, Croatia) that is the league's most distinctive feature.
  // Bosnia-Herzegovina, Gambia and Albania live in UNLISTED_NATIONALITIES.
  Turkey: {
    Turkey: 480, Brazil: 47, "Ivory Coast": 33, Senegal: 31, Nigeria: 26, France: 26,
    Portugal: 26, Germany: 26, Romania: 24, Mali: 24, Kosovo: 21, "Bosnia-Herzegovina": 16,
    Gambia: 14, Poland: 14, Croatia: 14, "Cape Verde": 12, Morocco: 12, "DR Congo": 12,
    Netherlands: 9, Albania: 9, Cameroon: 9, Scotland: 9, Denmark: 9, England: 9, Belgium: 9,
    Tunisia: 9,
    [REST]: 65,
  },
  // Eredivisie, taken from a real published breakdown (485 players). Half
  // domestic, and the foreign half is two things at once: the Belgian and
  // German neighbours it trades with, a genuine Scandinavian intake (Denmark,
  // Norway, Sweden and Iceland together outweigh any single nation but the
  // Belgians), and then the colonial pipeline — Curacao, Suriname and Indonesia
  // at 1.4% each, alongside Morocco at 3.1%. That last part is the thing an
  // outsider gets wrong: this table's first draft assumed the Eredivisie's
  // foreign half was development-market signings from Japan and South Korea and
  // a broad West African intake, and the real list has no Ghana or Nigeria in
  // it at all, one Japanese player for every two Moroccans, and three former
  // colonies in the top thirteen.
  Netherlands: {
    Netherlands: 503, Belgium: 41, Germany: 37, Denmark: 33, Morocco: 31, France: 31,
    Norway: 29, Sweden: 23, Spain: 19, Curacao: 14, Iceland: 14, Indonesia: 14,
    Suriname: 14, Brazil: 12, Japan: 12, Portugal: 10, Croatia: 10, Austria: 10,
    Poland: 8, Turkey: 8, "Czech Republic": 8, "United States": 8,
    // Below the source's cut-off, which lists 89% of the league. Named for the
    // reason Scotland's tail is: REST is ~40% English, and England does not
    // appear in the real top twenty-two at all.
    England: 5, Nigeria: 8, Ghana: 8, Serbia: 7, Switzerland: 6, "South Korea": 6,
    Argentina: 6, Italy: 6, Greece: 5, "Republic of Ireland": 5, Hungary: 5, Israel: 4,
    Finland: 4, Slovakia: 4, Australia: 4, "Ivory Coast": 4, Senegal: 4, "Cape Verde": 4,
    Colombia: 4, Egypt: 4,
    [REST]: 8,
  },
  // Scottish Premiership, taken from a real published breakdown (324 players).
  // The most lopsided foreign block in the game: England alone is 15.1%, close
  // to a quarter of every import, which no other league here comes near. Then
  // the Irish and Northern Irish traffic that comes with a shared border, and
  // an Anglophone tail — Australia at 5.2% is the joint-second nationality,
  // with Canada, the US and New Zealand behind it — that no mainland European
  // league has at all.
  Scotland: {
    Scotland: 358, England: 151, "Republic of Ireland": 52, Australia: 52,
    Wales: 25, "Northern Ireland": 22, Germany: 22, Netherlands: 19, France: 15,
    Canada: 12, Nigeria: 12, Austria: 12, Croatia: 12, Belgium: 12, Norway: 12,
    "United States": 9, Sweden: 9, "New Zealand": 9, Ghana: 9, Denmark: 9,
    Portugal: 9,
    // Below the source's cut-off, which lists 84% of the league. Named rather
    // than left to REST because that bucket is ~40% English (it is weighted
    // from the Premier League's own makeup), and England is already the largest
    // import here — a tail-sized REST would quietly push it past 20%.
    Japan: 8, Israel: 7, Poland: 7, Spain: 7, Greece: 6, Senegal: 6,
    "Ivory Coast": 6, Italy: 5, Brazil: 5, Jamaica: 5, Iceland: 5, Slovakia: 5,
    Finland: 5, Cameroon: 5, "South Africa": 5, Morocco: 4, Gambia: 4,
    "DR Congo": 4, Switzerland: 4, "Czech Republic": 4, Serbia: 4, Slovenia: 4,
    Zimbabwe: 4, Argentina: 4, Guinea: 3, Mali: 3, Ukraine: 3, Hungary: 3,
    [REST]: 23,
  },
  // Greek Super League, taken from a real published breakdown (429 players). A
  // little under half domestic, the most foreign-heavy table here after
  // Belgium's. The distinctive part is that the single biggest import is Spain
  // (6.3%) — not a neighbour and not Brazil. Greek clubs recruit the Iberian
  // and South American markets harder than anything on their own border, with
  // the Balkan neighbourhood (Serbia, Albania, Croatia, Bosnia) sitting
  // underneath that rather than on top of it.
  Greece: {
    Greece: 452, Spain: 63, Argentina: 47, France: 35, Serbia: 30, Portugal: 28,
    Brazil: 21, Sweden: 16, Albania: 16, Senegal: 16, Croatia: 14, Morocco: 14,
    Italy: 12, Nigeria: 12, Netherlands: 9, Guinea: 9,
    // Below the source's cut-off, which lists 79% of the league. Named for the
    // same reason Scotland's tail is.
    Ghana: 12, "Ivory Coast": 12, Cameroon: 10, "Bosnia-Herzegovina": 10,
    Romania: 10, Poland: 9, Denmark: 9, Belgium: 8, Uruguay: 8, Colombia: 8,
    Georgia: 8, Slovenia: 7, "Czech Republic": 7, Austria: 7, Switzerland: 7,
    Germany: 7, England: 7, Israel: 6, "North Macedonia": 6, Montenegro: 6,
    Egypt: 5, Ukraine: 5, Bulgaria: 5, Hungary: 5,
    [REST]: 22,
  },
  // Serbian SuperLiga, taken from a real published breakdown (430 players). By
  // far the most domestic table in the game at 66%, which is the point of it: a
  // production league that exports rather than imports. The surprise in the real
  // data is that the biggest import is not a neighbour but Ghana (4.2%) — the
  // West African intake (Ghana, Ivory Coast, Nigeria, Senegal, Mali) outweighs
  // the ex-Yugoslav one (Bosnia, Montenegro, North Macedonia, Slovenia).
  Serbia: {
    Serbia: 660, Ghana: 42, "Bosnia-Herzegovina": 35, Montenegro: 33,
    "Ivory Coast": 23, Nigeria: 23, Brazil: 19, Senegal: 14, Austria: 12,
    Spain: 9, France: 9, Mali: 7, Netherlands: 7, "North Macedonia": 7,
    Slovenia: 7, Switzerland: 7, Cameroon: 7,
    // Below the source's cut-off, which lists 92% of the league. The tail is
    // kept small and explicit here above all: the source has no English players
    // at all, and a REST bucket sized to the leftover 8% made England the
    // league's second-largest nationality out of nothing.
    Croatia: 7, Bulgaria: 6, Romania: 6, Guinea: 5, Albania: 5, Greece: 4,
    Hungary: 4, Ukraine: 4, Gambia: 4, "Burkina Faso": 3, "DR Congo": 3,
    Portugal: 3, Belgium: 3, Italy: 3, Slovakia: 3,
    [REST]: 16,
  },
  // ── The Americas ──────────────────────────────────────────────────────────
  // All four are real published breakdowns, entered as PLAYER COUNTS (the table
  // normalizes to its own total, so a count is as good a weight as a share).
  // Each source lists only its top nationalities, so each under-sums; the gap is
  // named explicitly as a tail of small nations rather than poured into REST,
  // for the reason Serbia's comment gives — the rest-of-world bucket is ~40%
  // English, and three of these leagues have no English players at all. REST is
  // held to ~0.5-1% of each table. Tail nations are this file's choice, not the
  // source's; the listed nations are the source's exactly.
  //
  // Brazilian Série A, 666 players: 74.9% Brazilian, then Argentina 44, Uruguay
  // 26, Colombia 16, Paraguay 13, Ecuador 10, Chile 9, Venezuela 6, Peru 4,
  // Bolivia 3, Portugal 3, United States 2, Spain 2, Angola 1, Costa Rica 1.
  // 27 unlisted: a 21-player named tail plus REST.
  Brazil: {
    Brazil: 499, Argentina: 44, Uruguay: 26, Colombia: 16, Paraguay: 13,
    Ecuador: 10, Chile: 9, Venezuela: 6, Peru: 4, Bolivia: 3,
    Portugal: 3, "United States": 2, Spain: 2, Angola: 1, "Costa Rica": 1,
    Italy: 2, France: 2, Netherlands: 2, Mexico: 2,
    "Cape Verde": 1, Mozambique: 1, "Guinea-Bissau": 1, Honduras: 1, Panama: 1,
    Japan: 2, Haiti: 1, Nigeria: 2, Germany: 1, Cameroon: 2,
    Canada: 1, Belgium: 1, Switzerland: 1,
    [REST]: 3,
  },
  // Argentine Liga Profesional, 891 players: 83.7% Argentine, then Uruguay 38,
  // Colombia 24, Paraguay 20, Chile 11, Ecuador 7, Venezuela 5, Peru 4, Brazil 3,
  // Mexico 2, United States 2, Spain 2, Italy 1, Bolivia 1. 25 unlisted: a
  // 19-player named tail plus REST.
  Argentina: {
    Argentina: 746, Uruguay: 38, Colombia: 24, Paraguay: 20, Chile: 11,
    Ecuador: 7, Venezuela: 5, Peru: 4, Brazil: 3, Mexico: 2,
    "United States": 2, Spain: 2, Italy: 1, Bolivia: 1,
    France: 2, Portugal: 2,
    Honduras: 1, "Costa Rica": 1, Panama: 1, Canada: 2, Guatemala: 1,
    "Dominican Republic": 1, Cuba: 1, Haiti: 2, Japan: 1, Israel: 1,
    Germany: 2, Netherlands: 1, Nicaragua: 1, "El Salvador": 1, Belgium: 1,
    [REST]: 3,
  },
  // Liga MX, 480 players: 62.9% Mexican, then Argentina 43, Colombia 27, Uruguay
  // 19, Brazil 19, United States 13, Spain 12, Paraguay 8, Ecuador 6, Chile 4,
  // Venezuela 3, Panama 3, Morocco 3, Portugal 3, Costa Rica 2, Canada 2, Peru 1,
  // Nigeria 1, France 1, Jamaica 1. Only 7 unlisted.
  Mexico: {
    Mexico: 302, Argentina: 43, Colombia: 27, Uruguay: 19, Brazil: 19,
    "United States": 13, Spain: 12, Paraguay: 8, Ecuador: 6, Chile: 4,
    Venezuela: 3, Panama: 3, Morocco: 3, Portugal: 3, "Costa Rica": 2,
    Canada: 2, Peru: 1, Nigeria: 1, France: 1, Jamaica: 1,
    Honduras: 2, Netherlands: 1, Italy: 1, Ghana: 1,
    [REST]: 2,
  },
  // MLS, 872 players (US and Canadian clubs): 39.7% American and 6.1% Canadian,
  // then Brazil 40, Argentina 31, Colombia 26, Germany 17, England 16, Ghana 15,
  // Spain 14, Mexico 13, France 12, Uruguay 12, Denmark 12, Venezuela 11,
  // Jamaica 11, Serbia 9, and 8 each for Norway, Chile, Israel, Poland, Ecuador
  // and Australia. The world only has US clubs, so Canada is an import here.
  //
  // The list stops at the 22nd nation and leaves 186 players (21%) unnamed, by
  // far the broadest tail of the four. It is named at 7 or fewer per nation
  // (nothing below the list's cut can exceed it) from the regions MLS publishes
  // its foreign intake from: Scandinavia and central Europe, West Africa,
  // Central America and the Caribbean, East Asia and Oceania. REST is ~1%, which
  // still lifts England from its stated 1.8% to ~2.2%.
  "United States": {
    "United States": 346, Canada: 53, Brazil: 40, Argentina: 31, Colombia: 26,
    Germany: 17, England: 16, Ghana: 15, Spain: 14, Mexico: 13,
    France: 12, Uruguay: 12, Denmark: 12, Venezuela: 11, Jamaica: 11,
    Serbia: 9, Norway: 8, Chile: 8, Israel: 8, Poland: 8,
    Ecuador: 8, Australia: 8,
    Sweden: 7, Netherlands: 7, Portugal: 7, Japan: 7, Paraguay: 7,
    Honduras: 7, "Costa Rica": 7,
    Nigeria: 6, Cameroon: 6, Senegal: 6, "Ivory Coast": 6, Scotland: 6,
    Croatia: 6, Peru: 6, Switzerland: 6, Austria: 6,
    "South Korea": 5, Italy: 5, Haiti: 5, Panama: 5, "Trinidad and Tobago": 5,
    "New Zealand": 5, Belgium: 5, Wales: 5, "Republic of Ireland": 5,
    "El Salvador": 4, Guatemala: 4, Iceland: 4, Finland: 4, Slovenia: 4,
    Guinea: 3, Kenya: 3, Mali: 3, Romania: 3,
    [REST]: 9,
  },
};

// Baseline frequency of every nation that has a name pool, used to weight a
// league's "Rest of the World" tail so it stays varied and realistic (a
// common football nation shows up in the tail more than an obscure one)
// rather than uniform. NATIONALITIES nations keep their listed weight;
// OTHER_NATIONS (name-pool-only) nations get a small flat weight.
const OTHER_TAIL_WEIGHT = 3;
const TAIL_BASE: Record<string, number> = (() => {
  const base: Record<string, number> = {};
  for (const [country, def] of Object.entries(NATIONALITIES)) base[country] = def.weight;
  for (const country of Object.keys(OTHER_NATIONS)) base[country] = (base[country] ?? 0) + OTHER_TAIL_WEIGHT;
  return base;
})();

/**
 * A nationality distribution as relative weights: nation name -> weight, plus
 * the optional REST_OF_WORLD sentinel for the combined "rest of the world"
 * share. Shipped leagues use the calibrated tables above; a league the player
 * adds can carry one it authored itself.
 */
export type NationalityWeights = Record<string, number>;

/**
 * The key standing for the combined "rest of the world" share in a weight
 * table. Exported so a hand-authored table (world editor, roster file) can name
 * the same bucket the shipped tables use, rather than inventing a second
 * spelling the draw wouldn't recognize.
 */
export const REST_OF_WORLD = REST;

interface DerivedTable {
  total: number;
  rest: { entries: [string, number][]; total: number };
}

/**
 * Per-table memoized derivations, so the thousands of draws a world generation
 * makes don't re-walk these every call.
 *
 * Keyed on the table OBJECT rather than the league name, because a league the
 * player added carries its own table and has no stable name to key on — the
 * country name is free text they can still be editing. Each shipped league's
 * table is likewise a distinct, stable object, so this covers both with one
 * cache and cannot collide.
 */
const derivedCache = new WeakMap<NationalityWeights, DerivedTable>();

function derivedFor(table: NationalityWeights): DerivedTable {
  const cached = derivedCache.get(table);
  if (cached) return cached;

  let total = 0;
  const named = new Set<string>();
  for (const [country, w] of Object.entries(table)) {
    total += w;
    if (country !== REST) named.add(country);
  }

  // The tail pool: every name-pool-bearing nation NOT already named in this
  // table, weighted by its TAIL_BASE frequency.
  const entries: [string, number][] = [];
  let restTotal = 0;
  for (const [country, w] of Object.entries(TAIL_BASE)) {
    if (named.has(country)) continue;
    entries.push([country, w]);
    restTotal += w;
  }

  // A hand-authored table can name every nation the game has and still carry a
  // rest-of-world row, leaving that row nothing to draw from. Its weight comes
  // back out of the total, so the roll simply never lands there and the named
  // nations normalize among themselves — which is what an empty "everyone else"
  // means. The shipped tables can't reach this (each names a dozen of 78), so
  // it only became possible once tables were player-authored.
  if (entries.length === 0) total -= table[REST] ?? 0;

  const built: DerivedTable = { total, rest: { entries, total: restTotal } };
  derivedCache.set(table, built);
  return built;
}

/**
 * The realized share of each nation in a table, as percentages summing to 100,
 * with the REST_OF_WORLD bucket left as its own entry.
 *
 * Exists for the world editor, and it is not cosmetic: a table's weights are
 * normalized to whatever they happen to total, so a breakdown copied from a
 * real source (which routinely over-sums — the published Belgian list came to
 * 116.5%, the Turkish to 130.7%) silently produces a *smaller* domestic share
 * than it states. Showing the realized share next to the typed number is what
 * makes that visible instead of a surprise 20 seasons later.
 */
export function nationalityShares(table: NationalityWeights): [string, number][] {
  const { total, rest } = derivedFor(table);
  if (total <= 0) return [];
  return Object.entries(table).map(([country, w]) => {
    // A rest-of-world row with nobody left in it draws nothing (see derivedFor),
    // so it reads 0 rather than a share it will never actually deliver.
    if (country === REST && rest.entries.length === 0) return [country, 0];
    return [country, (100 * w) / total];
  });
}

/**
 * What the REST_OF_WORLD bucket in a given table actually expands to, richest
 * first. The tail is weighted by TAIL_BASE, which is built from the shipped
 * NATIONALITIES weights — i.e. calibrated from the *Premier League's* foreign
 * makeup, not a neutral global prior — so it leans English (~40% of the bucket
 * when nothing is named). That is right for an English league's tail and
 * surprising anywhere else, which is why the editor shows it.
 */
export function restOfWorldPreview(table: NationalityWeights, limit = 6): [string, number][] {
  const { rest } = derivedFor(table);
  if (rest.total <= 0) return [];
  return rest.entries
    .map(([c, w]) => [c, (100 * w) / rest.total] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/**
 * Drop everything a hand-authored table can't express, so a bad table degrades
 * to a usable one rather than to gibberish players.
 *
 * A nation with no name pool is dropped outright: generateName falls back to
 * synthesized nonsense words for an unknown nationality, so keeping it would
 * fill a league with players called "Zek Vopar" and no flag. Non-finite and
 * non-positive weights go too (a zero-weight row is just an unnamed nation, and
 * a negative one would corrupt the roll). Returns null if nothing usable is
 * left, which callers read as "fall back to the shipped behaviour".
 */
export function sanitizeNationalityWeights(
  table: NationalityWeights | undefined,
): NationalityWeights | null {
  if (!table) return null;
  const out: NationalityWeights = {};
  let total = 0;
  for (const [country, weight] of Object.entries(table)) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) continue;
    if (country !== REST && !namePoolFor(country)) continue;
    out[country] = weight;
    total += weight;
  }
  return total > 0 ? out : null;
}

/**
 * Weighted-random nationality draw from a resolved weight table. When the roll
 * lands in the combined "Rest of the World" slot, a second weighted roll picks
 * from that table's tail of all other nations.
 */
function drawFrom(rng: () => number, table: NationalityWeights): string {
  const { total, rest } = derivedFor(table);

  let roll = rng() * total;
  for (const [country, w] of Object.entries(table)) {
    if (roll < w) {
      if (country !== REST) return country;
      // derivedFor removes an empty rest-of-world row's weight from the total,
      // so the roll can't land here with nothing to draw. Belt and braces
      // against a float edge, since the alternative is indexing entries[-1].
      if (rest.entries.length === 0) break;
      let restRoll = rng() * rest.total;
      for (const [tailCountry, tw] of rest.entries) {
        if (restRoll < tw) return tailCountry;
        restRoll -= tw;
      }
      return rest.entries[rest.entries.length - 1][0];
    }
    roll -= w;
  }
  // Roll should always be consumed above; fall back to the last named nation.
  const named = Object.keys(table).filter((c) => c !== REST);
  return named[named.length - 1] ?? "England";
}

/**
 * Weighted-random nationality draw for a league.
 *
 * `custom` is a league's own hand-authored table (a league the player added in
 * the world editor, or one a roster file declared) and wins outright when
 * present. Otherwise `homeCountry` selects that country's real-calibrated
 * distribution (see LEAGUE_NATIONALITY_WEIGHTS), and a missing or unrecognized
 * country falls back to England's table — the England-flavored default the
 * global free-agency / no-country pool has always used.
 *
 * Note the draw consumes ONE rng value, or TWO when it lands in the rest-of-
 * world bucket. That is unchanged by this parameter, and it is only ever called
 * on a player's own identity sub-stream (see generatePlayer), so which table a
 * league uses cannot shift the shared rng sequence for any other player.
 */
export function pickNationality(
  rng: () => number,
  homeCountry?: string,
  custom?: NationalityWeights | null,
): string {
  if (custom) return drawFrom(rng, custom);
  const key = homeCountry && LEAGUE_NATIONALITY_WEIGHTS[homeCountry] ? homeCountry : "England";
  return drawFrom(rng, LEAGUE_NATIONALITY_WEIGHTS[key]);
}

export function namePoolFor(nationality: string): { first: string[]; last: string[] } | undefined {
  return NATIONALITIES[nationality] ?? OTHER_NATIONS[nationality] ?? UNLISTED_NATIONALITIES[nationality];
}
