# Modelos 3D do NESC

A aba Manutenção usa um sistema de modelos 3D licenciados por veículo. Cada carro só
mostra um modelo 3D quando há um arquivo licenciado correspondente registrado; caso
contrário, aparece "Modelo 3D ainda não disponível" sobre o esquema do próprio veículo
(nunca outro carro no lugar). Nenhum carro de demonstração/genérico é publicado.

## Modelos licenciados por veículo (adicionados progressivamente)
Registrados em `CAR_MODELS3D` (index.html), indexados pelo id do catálogo. Cada arquivo
GLB fica em `models/` com seus créditos/licença anotados aqui ao ser adicionado, e só então
entra na cópia do build (`scripts/build.mjs`).
Nenhum ainda — slots reservados: Chevrolet Onix 2020 (hatch).

## Arquivo de TESTE (não publicado) — `tests/fixtures/car-concept.glb`
Não representa o carro de nenhum usuário e NÃO é copiado para `www/` nem servido em produção.
Serve apenas para os testes automatizados exercitarem o carregador GLB (carga, rotação, zoom,
descarregamento de GPU) com um modelo real.

Versão otimizada do modelo **Car Concept** do repositório oficial de exemplos do glTF:
- Fonte: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept
- Licença: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/legalcode)
- Créditos: Khronos Group / glTF Sample Assets (a partir de modelo CC0 de Unity Fan).
- Alterações: otimização para web (simplificação, quantização, texturas WebP).
